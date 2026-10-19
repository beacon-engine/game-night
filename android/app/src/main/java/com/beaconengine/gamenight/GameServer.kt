package com.beaconengine.gamenight

import android.content.Context
import android.util.Log
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

// Runs the beacon-arcade server (the same Go program as on a laptop, built for Linux on ARM) as a
// child process. It ships as lib/<abi>/libgamenight.so and is unpacked on install.
class GameServer(private val context: Context) {
    private var process: Process? = null

    // Starts the server and waits until it's listening. Returns the game select page's address.
    // Blocks: call it off the main thread.
    @Synchronized
    fun start(): String {
        stop()
        val binary = File(context.applicationInfo.nativeLibraryDir, "libgamenight.so")
        val webFiles = WebFiles.unpack(context)
        val userDir = File(context.filesDir, "user").apply { mkdirs() } // extra games, like on a laptop
        val port = (10000..10020).first(::isFree)

        val command = mutableListOf(
            binary.path, "-no-open", "-exit-with-stdin", "-port", "$port", "-web", webFiles.path, "-dir", userDir.path,
        )
        // Android doesn't let apps list network interfaces, so tell the server our Wi-Fi address
        DeviceInfo.wifiAddress(context)?.let { command += listOf("-host", it) }

        // its stdin stays open (a pipe to us) for as long as this app lives: if Android kills the app,
        // the pipe closes and the server stops itself (-exit-with-stdin), so it can't linger
        val p = ProcessBuilder(command).redirectErrorStream(true).start()
        process = p
        val lines = p.inputStream.bufferedReader()
        // wait for "is running", then keep passing its output to logcat
        while (true) {
            val line = lines.readLine() ?: error("beacon-arcade exited: ${p.waitFor()}")
            Log.i(TAG, line)
            if ("is running" in line) break
        }
        thread(name = "beacon-arcade-log", isDaemon = true) { lines.forEachLine { Log.i(TAG, it) } }
        return "http://127.0.0.1:$port/"
    }

    @Synchronized
    fun stop() {
        process?.let {
            it.destroy()
            if (!it.waitFor(2, TimeUnit.SECONDS)) it.destroyForcibly()
        }
        process = null
    }

    private fun isFree(port: Int) = runCatching {
        ServerSocket(port, 1, InetAddress.getByName("0.0.0.0")).close()
    }.isSuccess

    private companion object {
        const val TAG = "beacon-arcade"
    }
}
