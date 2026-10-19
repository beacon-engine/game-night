package com.beaconengine.gamenight

import android.content.Context
import java.io.File
import java.util.zip.ZipInputStream

// The game files (pages, scripts, models) ship once as assets/web.zip and are unpacked to the
// app's own storage the first time each install runs (a new version, or a reinstalled build). The
// server serves them from there.
object WebFiles {
    fun unpack(context: Context): File {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        val root = File(context.filesDir, "web")
        val dir = File(root, "${info.longVersionCode}-${info.lastUpdateTime}")
        val done = File(dir, ".unpacked")
        if (done.exists()) return dir

        root.deleteRecursively() // (older versions)
        dir.mkdirs()
        ZipInputStream(context.assets.open("web.zip").buffered()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                val out = File(dir, entry.name)
                require(out.canonicalPath.startsWith(dir.canonicalPath + File.separator)) { "bad path in web.zip: ${entry.name}" }
                if (entry.isDirectory) out.mkdirs()
                else {
                    out.parentFile?.mkdirs()
                    out.outputStream().use { zip.copyTo(it) }
                }
            }
        }
        done.createNewFile()
        return dir
    }
}
