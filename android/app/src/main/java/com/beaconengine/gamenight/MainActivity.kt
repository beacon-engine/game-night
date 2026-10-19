package com.beaconengine.gamenight

import android.annotation.SuppressLint
import android.app.Activity
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import kotlin.concurrent.thread

// The TV is the game screen: a full-screen WebView on the game select page, served by the
// game-night server running alongside (GameServer). Phones join it over the Wi-Fi as usual.
//
// While the app is in front, the server runs; when you leave it (Home, another app), the page and
// the server stop, so nothing keeps working the TV in the background.
class MainActivity : Activity() {
    private var web: WebView? = null
    private val server = GameServer(this)
    private var home: String? = null // the game select page, once the server is up

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        // debug builds: inspect the page from a computer (chrome://inspect)
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        createWebView()
    }

    override fun onStart() {
        super.onStart()
        hideSystemBars()
        web?.loadDataWithBaseURL(null, STARTING, "text/html", "utf-8", null)
        thread(name = "game-night-start") {
            val url = runCatching { server.start() }.getOrElse {
                Log.e(TAG, "server didn't start", it)
                null
            }
            runOnUiThread {
                home = url
                if (url != null) web?.loadUrl(url)
                else web?.loadDataWithBaseURL(null, FAILED, "text/html", "utf-8", null)
            }
        }
    }

    override fun onStop() {
        web?.loadUrl("about:blank") // closes the page's connection, stops its rendering
        server.stop()
        super.onStop()
    }

    override fun onDestroy() {
        web?.destroy()
        super.onDestroy()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        val view = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true // (games remember small things, like the last game played)
            settings.mediaPlaybackRequiresUserGesture = false
            setBackgroundColor(0xFF07080B.toInt())
            addJavascriptInterface(DeviceInfo(this@MainActivity), "GameNightApp")
            webViewClient = LocalPages()
            isFocusable = true
            isFocusableInTouchMode = true
        }
        web = view
        setContentView(view)
        view.requestFocus()
    }

    // Only Game Night's own pages; and if the page's renderer is killed (a 1 GB TV running out of
    // memory), start a fresh WebView on the game select page instead of crashing the app.
    private inner class LocalPages : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) =
            request.url.host != "127.0.0.1"

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            Log.w(TAG, "page renderer gone (crashed: ${detail.didCrash()}); reloading the game select page")
            (view.parent as? android.view.ViewGroup)?.removeView(view)
            view.destroy()
            createWebView()
            home?.let { web?.loadUrl(it) }
            return true
        }
    }

    // The remote's Back: Esc inside a game (its menus handle it: pause, back to the lobby, back to
    // the games); on the game select page, leave the app.
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode != KeyEvent.KEYCODE_BACK) return super.dispatchKeyEvent(event)
        if (event.action == KeyEvent.ACTION_UP) {
            val page = web?.url?.let(Uri::parse)
            if (page == null || page.host != "127.0.0.1" || page.path.isNullOrEmpty() || page.path == "/") finish()
            else web?.evaluateJavascript(ESCAPE, null)
        }
        return true
    }

    private fun hideSystemBars() {
        window.insetsController?.let {
            it.hide(WindowInsets.Type.systemBars())
            it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        } ?: run {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        }
    }

    companion object {
        const val TAG = "GameNight"
        private const val ESCAPE =
            "for (const type of ['keydown', 'keyup']) dispatchEvent(new KeyboardEvent(type, { key: 'Escape', code: 'Escape' }));"
        private fun page(text: String) = """<html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
            background:#07080b;color:#a6a4ae;font:600 18px/1.4 sans-serif;letter-spacing:.14em;text-transform:uppercase">$text</body></html>"""
        private val STARTING = page("Starting Game Night…")
        private val FAILED = page("Game Night couldn't start. Restart the app.")
    }
}
