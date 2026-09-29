package com.treas_rec.v2_6_0_evc;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.RecognitionListener;
import org.vosk.android.SpeechService;
import org.vosk.android.StorageService;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * EVE offline voice service.
 *
 *  - Runs as a microphone FOREGROUND SERVICE so Android keeps listening
 *    while the app is in the background or the screen is off.
 *  - Uses Vosk (Kaldi) fully OFFLINE. No audio ever leaves the phone.
 *  - Wake-word gating happens HERE (natively), so the WebView does not have
 *    to be alive/awake to decide whether you addressed "Eve".
 *  - Two recognizer modes:
 *      COMMAND   : restricted grammar (fast, accurate, low CPU)
 *      DICTATION : open vocabulary (used only while filling a form field)
 */
public class EveVoiceService extends Service implements RecognitionListener {

    private static final String TAG = "EveVoice";
    static final String CHANNEL_ID = "eve_voice_listening";
    static final int NOTIF_ID = 4711;
    static final String ACTION_STOP = "com.treas_rec.v2_6_0_evc.EVE_STOP";
    static final String PREFS = "eve_voice_prefs";
    private static final float SAMPLE_RATE = 16000.0f;

    /** Bridge to the Capacitor plugin (set by EveVoicePlugin). */
    interface Listener { void onEvent(String type, String text, boolean flag); }

    static volatile Listener listener;
    static volatile EveVoiceService instance;
    static volatile boolean appVisible = false;
    static volatile boolean modelReady = false;
    static volatile String state = "stopped";

    /** Commands heard while the app was hidden: {timestampMillis, text}. */
    static final List<String[]> pending = new ArrayList<>();

    private final Handler main = new Handler(Looper.getMainLooper());

    private Model model;
    private Recognizer recognizer;
    private SpeechService speech;
    private PowerManager.WakeLock wakeLock;

    // ---- config (loaded from SharedPreferences) ----
    private String grammarJson = "";
    private List<String> wakeWords = Arrays.asList("eve");
    private List<String> wakePrefixes = Arrays.asList("hey", "okay", "ok");
    private long awakeMs = 8000;
    private boolean bgLaunch = false;

    // ---- runtime ----
    private volatile boolean muted = false;
    private boolean dictation = false;
    private long awakeUntil = 0;
    private boolean wakeAnnounced = false;

    // =====================================================================
    //  Static helpers used by the plugin
    // =====================================================================

    static void saveConfig(Context ctx, String grammar, String wakeCsv, String prefixCsv,
                           long awakeMs, boolean bgLaunch) {
        ctx.getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putString("grammar", grammar == null ? "" : grammar)
                .putString("wake", wakeCsv == null ? "eve" : wakeCsv)
                .putString("prefix", prefixCsv == null ? "" : prefixCsv)
                .putLong("awakeMs", awakeMs)
                .putBoolean("bgLaunch", bgLaunch)
                .apply();
        final EveVoiceService s = instance;
        if (s != null) s.main.post(() -> { s.loadPrefs(); s.startRecognizer(); });
    }

    static void startService(Context ctx) {
        ContextCompat.startForegroundService(ctx, new Intent(ctx, EveVoiceService.class));
    }

    static void stopService(Context ctx) {
        ctx.stopService(new Intent(ctx, EveVoiceService.class));
    }

    static void setMuted(boolean m) {
        final EveVoiceService s = instance;
        if (s == null) return;
        s.main.post(() -> {
            s.muted = m;
            if (s.speech != null) {
                s.speech.setPause(m);
                if (!m) { try { s.speech.reset(); } catch (Exception ignored) { } }
            }
        });
    }

    static void setDictation(boolean on) {
        final EveVoiceService s = instance;
        if (s == null) return;
        s.main.post(() -> {
            if (s.dictation == on) return;
            s.dictation = on;
            s.awakeUntil = 0;
            s.startRecognizer();
        });
    }

    // =====================================================================
    //  Service lifecycle
    // =====================================================================

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createChannel();
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "EveVoice:listen");
            wakeLock.setReferenceCounted(false);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            Notification n = buildNotification("Loading offline voice model…");
            if (Build.VERSION.SDK_INT >= 30) {
                // 128 == ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                startForeground(NOTIF_ID, n, 128);
            } else {
                startForeground(NOTIF_ID, n);
            }
        } catch (Exception e) {
            Log.e(TAG, "startForeground failed", e);
            emit("error", "Android refused to start the microphone service: " + e.getMessage(), false);
            stopSelf();
            return START_NOT_STICKY;
        }

        loadPrefs();
        if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire();

        if (model == null) loadModel();
        else startRecognizer();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        instance = null;
        stopRecognizer();
        if (model != null) { try { model.close(); } catch (Exception ignored) { } model = null; }
        modelReady = false;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        state = "stopped";
        emit("state", "stopped", false);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    // =====================================================================
    //  Model + recognizer
    // =====================================================================

    private void loadPrefs() {
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        grammarJson = p.getString("grammar", "");
        wakeWords = splitCsv(p.getString("wake", "eve"));
        if (wakeWords.isEmpty()) wakeWords = Arrays.asList("eve");
        wakePrefixes = splitCsv(p.getString("prefix", "hey,okay,ok"));
        awakeMs = p.getLong("awakeMs", 8000);
        bgLaunch = p.getBoolean("bgLaunch", false);
    }

    private static List<String> splitCsv(String csv) {
        List<String> out = new ArrayList<>();
        if (csv == null) return out;
        for (String s : csv.split(",")) {
            String t = s.trim().toLowerCase();
            if (!t.isEmpty()) out.add(t);
        }
        return out;
    }

    private void loadModel() {
        setState("loading", "Loading offline voice model…");
        // Copies assets/model -> app storage the first time, then loads it.
        StorageService.unpack(this, "model", "model",
                (Model m) -> {
                    if (instance != this) { m.close(); return; }
                    model = m;
                    modelReady = true;
                    startRecognizer();
                },
                (IOException e) -> {
                    Log.e(TAG, "Model load failed", e);
                    setState("error", "Voice model failed to load: " + e.getMessage());
                    emit("error", "Voice model failed to load: " + e.getMessage(), false);
                });
    }

    private void startRecognizer() {
        if (model == null) return;
        stopRecognizer();
        try {
            boolean useGrammar = !dictation && grammarJson != null && grammarJson.length() > 2;
            recognizer = useGrammar
                    ? new Recognizer(model, SAMPLE_RATE, grammarJson)
                    : new Recognizer(model, SAMPLE_RATE);
            speech = new SpeechService(recognizer, SAMPLE_RATE);
            speech.setPause(muted);
            if (!speech.startListening(this)) {
                emit("error", "The microphone is busy (another app is using it).", false);
                setState("error", "Microphone busy");
                return;
            }
            wakeAnnounced = false;
            setState("listening", dictation ? "Dictating…" : "Say “Eve” then a command");
        } catch (IOException | RuntimeException e) {
            Log.e(TAG, "Recognizer start failed", e);
            emit("error", "Could not start listening: " + e.getMessage(), false);
            setState("error", "Could not start listening");
        }
    }

    private void stopRecognizer() {
        try {
            if (speech != null) { speech.stop(); speech.shutdown(); }
        } catch (Exception ignored) { }
        speech = null;
        try {
            if (recognizer != null) recognizer.close();
        } catch (Exception ignored) { }
        recognizer = null;
    }

    // =====================================================================
    //  RecognitionListener (called on the main thread)
    // =====================================================================

    @Override
    public void onPartialResult(String hypothesis) {
        if (muted) return;
        String t = clean(extract(hypothesis, "partial"));
        if (t.isEmpty()) return;
        if (dictation) { emit("dictation", t, false); return; }
        // Instant "I heard my name" feedback before the sentence is finished.
        if (!wakeAnnounced && System.currentTimeMillis() >= awakeUntil
                && wakeTokens(t.split(" ")) >= 0) {
            wakeAnnounced = true;
            if (appVisible) emit("wake_heard", "", false);
        }
    }

    @Override
    public void onResult(String hypothesis) {
        wakeAnnounced = false;
        if (muted) return;
        String t = clean(extract(hypothesis, "text"));
        if (t.isEmpty()) return;

        if (dictation) { emit("dictation", t, true); return; }

        String[] tok = t.split(" ");
        int used = wakeTokens(tok);
        long now = System.currentTimeMillis();

        if (used >= 0) {
            String rest = join(tok, used);
            if (rest.isEmpty()) {                 // just "Eve" -> wait for the command
                awakeUntil = now + awakeMs;
                deliverWake();
            } else {                              // "Eve, go to students"
                awakeUntil = 0;
                deliverCommand(rest);
            }
        } else if (now < awakeUntil) {            // command spoken after a bare "Eve"
            awakeUntil = 0;
            deliverCommand(t);
        }
        // anything else = ordinary conversation -> ignored on purpose
    }

    @Override public void onFinalResult(String hypothesis) { /* fires on stop(); ignore */ }

    @Override
    public void onError(Exception e) {
        Log.e(TAG, "Recognizer error", e);
        emit("error", "Listening error: " + e.getMessage(), false);
        setState("error", "Listening error");
    }

    @Override public void onTimeout() { }

    // =====================================================================
    //  Wake word parsing / delivery
    // =====================================================================

    /** Returns how many leading tokens form the wake phrase ("hey eve" = 2), or -1. */
    private int wakeTokens(String[] tok) {
        int i = 0;
        if (tok.length > 0 && wakePrefixes.contains(tok[0])) i = 1;
        if (i < tok.length && wakeWords.contains(tok[i])) return i + 1;
        return -1;
    }

    private static String join(String[] tok, int from) {
        StringBuilder sb = new StringBuilder();
        for (int i = from; i < tok.length; i++) {
            if (sb.length() > 0) sb.append(' ');
            sb.append(tok[i]);
        }
        return sb.toString();
    }

    private void deliverWake() {
        if (appVisible && listener != null) { emit("wake", "", false); return; }
        if (bgLaunch) bringToFront();
    }

    private void deliverCommand(String text) {
        if (appVisible && listener != null) { emit("command", text, false); return; }
        if (!bgLaunch) return;                    // user did not allow background launch
        synchronized (pending) {
            pending.add(new String[]{String.valueOf(System.currentTimeMillis()), text});
            while (pending.size() > 5) pending.remove(0);
        }
        bringToFront();
    }

    private void bringToFront() {
        try {
            Intent i = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (i == null) return;
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(i);   // only works when "Display over other apps" is allowed
        } catch (Exception e) {
            Log.w(TAG, "Could not bring app to front: " + e.getMessage());
        }
    }

    // =====================================================================
    //  Utilities
    // =====================================================================

    private static String extract(String json, String key) {
        try { return new JSONObject(json).optString(key, ""); }
        catch (Exception e) { return ""; }
    }

    private static String clean(String s) {
        if (s == null) return "";
        return s.toLowerCase()
                .replace("[unk]", " ")
                .replace("<unk>", " ")
                .replaceAll("\\s+", " ")
                .trim();
    }

    private void emit(String type, String text, boolean flag) {
        Listener l = listener;
        if (l != null) l.onEvent(type, text, flag);
    }

    private void setState(String s, String notificationText) {
        state = s;
        emit("state", s, false);
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, buildNotification(notificationText));
        } catch (Exception ignored) { }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "Eve voice assistant", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Shows that Eve is listening for her wake word (offline).");
        ch.setShowBadge(false);
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.createNotificationChannel(ch);
    }

    private Notification buildNotification(String text) {
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent openPi = open == null ? null : PendingIntent.getActivity(
                this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Intent stop = new Intent(this, EveVoiceService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(
                this, 1, stop, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("Eve voice assistant (offline)")
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .addAction(0, "Turn off", stopPi);
        if (openPi != null) b.setContentIntent(openPi);
        return b.build();
    }
}
