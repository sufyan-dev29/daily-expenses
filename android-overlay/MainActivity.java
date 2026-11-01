package com.dailyexpenses.app;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BiometricVaultPlugin.class);
        super.onCreate(savedInstanceState);
        if (!BuildConfig.DEBUG) {
            // Hide the app contents in the recents screen and block screenshots in release builds.
            getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        }
    }
}
