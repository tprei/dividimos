import Capacitor
import WebKit

class MainViewController: CAPBridgeViewController {
    private var delegateOverrides: CapacitorDelegateOverrides?

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(FcmTokenPlugin())
        guard let webView, let capacitorDelegate = webView.navigationDelegate as? WebViewDelegationHandler else {
            return
        }
        let overrides = CapacitorDelegateOverrides(
            presenter: self,
            capacitorDelegate: capacitorDelegate,
            hasErrorPage: bridge?.config.errorPathURL != nil
        )
        delegateOverrides = overrides
        webView.navigationDelegate = overrides
        webView.uiDelegate = overrides
    }
}

/// Sits in front of Capacitor's WebView delegate for two behaviors it lacks on
/// iOS; every other delegate call goes to Capacitor unchanged.
/// - Capacitor only shows `server.errorPath` when a load fails at the network
///   level. A 5xx page from the hosted app is cancelled here, which fails the
///   navigation and makes Capacitor show offline.html, as Android already does.
///   Dev builds have no error page, so Next's error pages stay visible there.
/// - Capacitor titles JavaScript `confirm()` buttons "Cancel" and "Ok".
final class CapacitorDelegateOverrides: NSObject, WKNavigationDelegate, WKUIDelegate {
    private weak var presenter: UIViewController?
    private weak var capacitorDelegate: WebViewDelegationHandler?
    private let hasErrorPage: Bool

    init(presenter: UIViewController, capacitorDelegate: WebViewDelegationHandler, hasErrorPage: Bool) {
        self.presenter = presenter
        self.capacitorDelegate = capacitorDelegate
        self.hasErrorPage = hasErrorPage
    }

    override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || capacitorDelegate?.responds(to: aSelector) == true
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        capacitorDelegate
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        let status = (navigationResponse.response as? HTTPURLResponse)?.statusCode ?? 0
        decisionHandler(hasErrorPage && navigationResponse.isForMainFrame && status >= 500 ? .cancel : .allow)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        guard var host = presenter else {
            completionHandler(false)
            return
        }
        // Presenting over another sheet from the root would be dropped, and
        // WebKit raises if the completion handler is never called.
        while let top = host.presentedViewController, !top.isBeingDismissed {
            host = top
        }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancelar", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        host.present(alert, animated: true)
    }
}
