package com.beaconengine.gamenight

import android.app.ActivityManager
import android.content.Context
import android.net.ConnectivityManager
import android.os.Build
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.net.Inet4Address

// Tells the page what this TV is, so games it can't run well aren't offered
// (read by web/platform/device.ts as window.GameNightApp.device()).
class DeviceInfo(private val context: Context) {
    @JavascriptInterface
    fun device(): String {
        val am = context.getSystemService(ActivityManager::class.java)
        val memory = ActivityManager.MemoryInfo().also(am::getMemoryInfo)
        return JSONObject()
            .put("memoryMB", memory.totalMem / (1024 * 1024))
            .put("lowRam", am.isLowRamDevice)
            .put("cores", Runtime.getRuntime().availableProcessors())
            .put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
            .toString()
    }

    companion object {
        // This device's IPv4 address on its current network (Wi-Fi or ethernet), for the phones
        fun wifiAddress(context: Context): String? {
            val cm = context.getSystemService(ConnectivityManager::class.java)
            val link = cm.getLinkProperties(cm.activeNetwork) ?: return null
            return link.linkAddresses.map { it.address }
                .firstOrNull { it is Inet4Address && !it.isLoopbackAddress }
                ?.hostAddress
        }
    }
}
