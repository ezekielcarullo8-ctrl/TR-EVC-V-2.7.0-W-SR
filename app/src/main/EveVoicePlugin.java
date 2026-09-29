package com.treas_rec.v2_6_0_evc;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * JavaScript name: window.Capacitor.Plugins.EveVoice
 *
 * Methods : start, stop, configure, setMuted, setDictation, status,
 *           requestNotificationPermission, requestBatteryExemption,
 *           openOverlaySettings, openAppSettings
 * Events  : state, wake_heard, wake, command, dictation, error
 *           payload: { text: string, flag: boolean }
 */
@CapacitorPlugin(
        name = "EveVoice",
        permissions = {
                @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
                @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" })
        }
)
public class EveVoicePlugin extends Plugin {

    // ---------------------------------------------------------------- lifecycle

    @Override
    public void load() {
        EveVoiceService.appVisible = true;
        EveVoiceService.listener = (type, text, flag) -> {
            JSObject d = new JSObject();
            d.put("text", text);
            d.put("flag", flag);
            // keep wake/command events until JS is listening (app just relaunched)
            boolean retain = "command".equals(type) || "wake".equals(type);
            notifyListeners(type, d, retain);
        };
    }

    @Override
    protected void handleOnResume() {
        EveVoiceService.appVisible = true;
        flushPending();
    }

    @Override
    protected void handleOnPause() {
        EveVoiceService.appVisible = false;
    }

    @Override
    protected void handleOnDestroy() {
        EveVoiceService.appVisible = false;
        EveVoiceService.listener = null;
    }

    /** Deliver commands that were heard while the app was hidden (max 20 s old). */
    private void flushPending() {
        java.util.List<String[]> copy;
        synchronized (EveVoiceService.pending) {
            copy = new java.util.ArrayList<>(EveVoiceService.pending);
            EveVoiceService.pending.clear();
        }
        long now = System.currentTimeMillis();
        for (String[] item : copy) {
            long ts;
            try { ts = Long.parseLong(item[0]); } catch (Exception e) { continue; }
            if (now - ts > 20000) continue;
            JSObject d = new JSObject();
            d.put("text", item[1]);
            d.put("flag", true);   // flag=true means "was queued in background"
            notifyListeners("command", d, true);
        }
    }

    // ------------------------------------------------------------------ start/stop

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micPermissionCallback");
            return;
        }
        doStart(call);
    }

    @PermissionCallback
    private void micPermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            doStart(call);
        } else {
            call.reject("Microphone permission was denied. Allow it in App settings to use Eve.");
        }
    }

    private void doStart(PluginCall call) {
        saveConfigFromCall(call);
        try {
            EveVoiceService.startService(getContext());
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not start the voice service: " + e.getMessage());
        }
    }

    @PluginMethod
    public void configure(PluginCall call) {
        saveConfigFromCall(call);
        call.resolve();
    }

    private void saveConfigFromCall(PluginCall call) {
        Integer awake = call.getInt("awakeMs", 8000);
        Boolean bg = call.getBoolean("bgLaunch", false);
        EveVoiceService.saveConfig(
                getContext(),
                call.getString("grammar", ""),
                call.getString("wakeWords", "eve"),
                call.getString("wakePrefixes", "hey,okay,ok"),
                awake == null ? 8000L : awake.longValue(),
                bg != null && bg);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        EveVoiceService.stopService(getContext());
        call.resolve();
    }

    @PluginMethod
    public void setMuted(PluginCall call) {
        Boolean m = call.getBoolean("muted", false);
        EveVoiceService.setMuted(m != null && m);
        call.resolve();
    }

    @PluginMethod
    public void setDictation(PluginCall call) {
        Boolean on = call.getBoolean("on", false);
        EveVoiceService.setDictation(on != null && on);
        call.resolve();
    }

    // ---------------------------------------------------------------- status/permissions

    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        JSObject r = new JSObject();
        r.put("running", EveVoiceService.instance != null);
        r.put("modelReady", EveVoiceService.modelReady);
        r.put("state", EveVoiceService.state);
        r.put("microphone", getPermissionState("microphone") == PermissionState.GRANTED);
        r.put("notifications", Build.VERSION.SDK_INT < 33
                || getPermissionState("notifications") == PermissionState.GRANTED);
        r.put("overlay", Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(ctx));
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        r.put("batteryUnrestricted",
                pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName()));
        call.resolve(r);
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33
                || getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve();
            return;
        }
        requestPermissionForAlias("notifications", call, "notifPermissionCallback");
    }

    @PermissionCallback
    private void notifPermissionCallback(PluginCall call) {
        call.resolve();   // optional permission: never block the voice assistant on it
    }

    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open battery settings: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open overlay settings: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open app settings: " + e.getMessage());
        }
    }
}
