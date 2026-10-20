package com.shadowai.app.hologram

import android.annotation.SuppressLint
import android.content.Context
import android.opengl.GLSurfaceView
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView

@SuppressLint("ClickableViewAccessibility")
class HologramSurfaceView(context: Context) : GLSurfaceView(context) {

    val renderer: HologramRenderer

    private var previousX = 0f
    private var previousY = 0f
    private val scaleDetector: ScaleGestureDetector

    init {
        // Request OpenGL ES 2.0 context
        setEGLContextClientVersion(2)
        renderer = HologramRenderer()
        setRenderer(renderer)
        renderMode = RENDERMODE_CONTINUOUSLY

        scaleDetector = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(detector: ScaleGestureDetector): Boolean {
                val scaleFactor = detector.scaleFactor
                // Adjust zoom clamped between 2.2f and 8.0f
                renderer.zoom = (renderer.zoom / scaleFactor).coerceIn(2.2f, 8.0f)
                return true
            }
        })
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        scaleDetector.onTouchEvent(event)

        if (event.pointerCount == 1) {
            val x = event.x
            val y = event.y

            when (event.action) {
                MotionEvent.ACTION_MOVE -> {
                    val dx = x - previousX
                    val dy = y - previousY

                    // Drag to rotate
                    renderer.rotationY += dx * 0.4f
                    renderer.rotationX = (renderer.rotationX + dy * 0.4f).coerceIn(-75f, 75f)
                }
            }
            previousX = x
            previousY = y
        }
        return true
    }
}

@Composable
fun HologramView(
    modifier: Modifier = Modifier,
    state: HologramState = HologramState.IDLE,
    onViewReady: ((HologramSurfaceView) -> Unit)? = null
) {
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            HologramSurfaceView(ctx).also {
                it.renderer.state = state
                onViewReady?.invoke(it)
            }
        },
        update = { view ->
            view.renderer.state = state
        }
    )
}
