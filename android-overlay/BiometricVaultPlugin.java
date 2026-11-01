package com.dailyexpenses.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.concurrent.Executor;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Stores a small secret encrypted with an Android Keystore AES key that can only be used
 * after a fingerprint / face check (CryptoObject-bound). The key never leaves the secure hardware.
 */
@CapacitorPlugin(name = "BiometricVault")
public class BiometricVaultPlugin extends Plugin {
    private static final String PREFS = "bio_vault";
    private static final int AUTH = BiometricManager.Authenticators.BIOMETRIC_STRONG;

    private static String keyAlias(String a) { return "de_bio_" + a; }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        int r = BiometricManager.from(getContext()).canAuthenticate(AUTH);
        JSObject o = new JSObject();
        o.put("available", r == BiometricManager.BIOMETRIC_SUCCESS);
        if (r != BiometricManager.BIOMETRIC_SUCCESS) o.put("reason", String.valueOf(r));
        call.resolve(o);
    }

    private SecretKey createKey(String alias) throws Exception {
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(keyAlias(alias),
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(true)
                .setRandomizedEncryptionRequired(true);
        if (Build.VERSION.SDK_INT >= 24) b.setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= 30) {
            b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        }
        kg.init(b.build());
        return kg.generateKey();
    }

    private SecretKey loadKey(String alias) throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        return (SecretKey) ks.getKey(keyAlias(alias), null);
    }

    private void deleteKey(String alias) {
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            ks.deleteEntry(keyAlias(alias));
        } catch (Exception ignored) { }
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("d_" + alias).apply();
    }

    private void prompt(PluginCall call, Cipher cipher, BiometricPrompt.AuthenticationCallback cb) {
        FragmentActivity act = getActivity();
        if (act == null) { call.reject("No activity", "UNAVAILABLE"); return; }
        String title = call.getString("title", "Daily Expenses");
        String subtitle = call.getString("subtitle", "");
        act.runOnUiThread(() -> {
            Executor ex = ContextCompat.getMainExecutor(getContext());
            BiometricPrompt p = new BiometricPrompt(act, ex, cb);
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title).setSubtitle(subtitle)
                    .setNegativeButtonText("Cancel")
                    .setAllowedAuthenticators(AUTH)
                    .setConfirmationRequired(false)
                    .build();
            p.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
        });
    }

    private static boolean isCancel(int code) {
        return code == BiometricPrompt.ERROR_USER_CANCELED || code == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                || code == BiometricPrompt.ERROR_CANCELED;
    }

    @PluginMethod
    public void enroll(PluginCall call) {
        String alias = call.getString("alias");
        String secret = call.getString("secret");
        if (alias == null || secret == null || secret.isEmpty()) { call.reject("Missing arguments", "FAILED"); return; }
        try {
            deleteKey(alias);
            SecretKey key = createKey(alias);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key);
            prompt(call, c, new BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult r) {
                    try {
                        Cipher done = r.getCryptoObject().getCipher();
                        byte[] ct = done.doFinal(secret.getBytes(StandardCharsets.UTF_8));
                        byte[] iv = done.getIV();
                        byte[] all = new byte[iv.length + ct.length + 1];
                        all[0] = (byte) iv.length;
                        System.arraycopy(iv, 0, all, 1, iv.length);
                        System.arraycopy(ct, 0, all, 1 + iv.length, ct.length);
                        SharedPreferences sp = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                        sp.edit().putString("d_" + alias, Base64.encodeToString(all, Base64.NO_WRAP)).apply();
                        call.resolve();
                    } catch (Exception e) {
                        deleteKey(alias);
                        call.reject("Could not store the secret", "FAILED");
                    }
                }
                @Override public void onAuthenticationError(int code, @NonNull CharSequence msg) {
                    deleteKey(alias);
                    call.reject(msg.toString(), isCancel(code) ? "CANCELLED" : "FAILED");
                }
            });
        } catch (Exception e) {
            deleteKey(alias);
            call.reject("Biometric sign-in is not available", "UNAVAILABLE");
        }
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        String alias = call.getString("alias");
        if (alias == null) { call.reject("Missing arguments", "FAILED"); return; }
        String stored = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("d_" + alias, null);
        if (stored == null) { call.reject("Not set up", "INVALIDATED"); return; }
        try {
            byte[] all = Base64.decode(stored, Base64.NO_WRAP);
            int ivLen = all[0] & 0xff;
            byte[] iv = new byte[ivLen];
            System.arraycopy(all, 1, iv, 0, ivLen);
            byte[] ct = new byte[all.length - 1 - ivLen];
            System.arraycopy(all, 1 + ivLen, ct, 0, ct.length);
            SecretKey key = loadKey(alias);
            if (key == null) { deleteKey(alias); call.reject("Key missing", "INVALIDATED"); return; }
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
            prompt(call, c, new BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult r) {
                    try {
                        byte[] pt = r.getCryptoObject().getCipher().doFinal(ct);
                        JSObject o = new JSObject();
                        o.put("secret", new String(pt, StandardCharsets.UTF_8));
                        call.resolve(o);
                    } catch (Exception e) {
                        call.reject("Could not read the secret", "FAILED");
                    }
                }
                @Override public void onAuthenticationError(int code, @NonNull CharSequence msg) {
                    call.reject(msg.toString(), isCancel(code) ? "CANCELLED" : "FAILED");
                }
            });
        } catch (KeyPermanentlyInvalidatedException e) {
            deleteKey(alias);
            call.reject("Biometrics changed", "INVALIDATED");
        } catch (Exception e) {
            call.reject("Biometric sign-in is not available", "UNAVAILABLE");
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String alias = call.getString("alias");
        if (alias != null) deleteKey(alias);
        call.resolve();
    }
}
