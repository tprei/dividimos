package ai.dividimos.app;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;
import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;

public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {
    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Bridge bridge = getBridge();
        if (bridge == null) {
            return;
        }
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                if (request.isForMainFrame() && errorResponse.getStatusCode() < 500) {
                    return;
                }
                super.onReceivedHttpError(view, request, errorResponse);
            }
        });
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                String errorUrl = bridge.getErrorUrl();
                if (errorUrl != null && errorUrl.equals(bridge.getWebView().getUrl())) {
                    finish();
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }

    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN
                && requestCode <= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) {
            PluginHandle handle = getBridge().getPlugin("SocialLogin");
            if (handle != null) {
                Plugin plugin = handle.getInstance();
                if (plugin instanceof SocialLoginPlugin) {
                    ((SocialLoginPlugin) plugin).handleGoogleLoginIntent(requestCode, data);
                }
            }
        }
    }
}
