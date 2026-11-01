package com.dailyexpenses.app;

import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Reads the phone's own accent colour (Material You, Android 12+). Older phones return nothing. */
@CapacitorPlugin(name = "SystemColors")
public class SystemColorsPlugin extends Plugin {
    @PluginMethod
    public void get(PluginCall call) {
        JSObject o = new JSObject();
        if (Build.VERSION.SDK_INT >= 31) {
            try {
                int c = getContext().getResources().getColor(android.R.color.system_accent1_600, getContext().getTheme());
                o.put("seed", String.format("#%06X", c & 0xFFFFFF));
            } catch (Exception ignored) { }
        }
        call.resolve(o);
    }
}
