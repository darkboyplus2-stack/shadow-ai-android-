package com.shadowai.app.hologram

import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.opengl.Matrix
import android.os.SystemClock
import java.nio.FloatBuffer
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.sin

enum class HologramState {
    IDLE, LISTENING, THINKING, SPEAKING, WORKING, ERROR
}

class HologramRenderer : GLSurfaceView.Renderer {

    // Matrices
    private val vPMatrix = FloatArray(16)
    private val projectionMatrix = FloatArray(16)
    private val viewMatrix = FloatArray(16)
    private val modelMatrix = FloatArray(16)
    private val mvpMatrix = FloatArray(16)

    // Shader programs
    private var mainProgram = 0
    private var lineProgram = 0

    // Geometry buffers
    private var sphereVertCount = 0
    private lateinit var sphereVertices: FloatBuffer
    private lateinit var sphereNormals: FloatBuffer

    private var coreVertCount = 0
    private lateinit var coreVertices: FloatBuffer
    private lateinit var coreNormals: FloatBuffer

    private lateinit var ring1Vertices: FloatBuffer
    private lateinit var ring2Vertices: FloatBuffer
    private lateinit var particles: FloatBuffer

    // Interactive controls (volatile for multi-threading between UI and GL thread)
    @Volatile var state: HologramState = HologramState.IDLE
    @Volatile var rotationX = 12.0f
    @Volatile var rotationY = 0.0f
    @Volatile var zoom = 4.2f

    private var startTime = SystemClock.uptimeMillis()

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        // Deep obsidian space background
        GLES20.glClearColor(0.018f, 0.018f, 0.026f, 1.0f)
        GLES20.glEnable(GLES20.GL_DEPTH_TEST)
        GLES20.glDepthFunc(GLES20.GL_LEQUAL)

        // Enable additive blending for glowing holographic energy
        GLES20.glEnable(GLES20.GL_BLEND)
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE)

        // Compile shaders
        mainProgram = createProgram(Shaders.VERTEX_SHADER, Shaders.FRAGMENT_SHADER)
        lineProgram = createProgram(Shaders.LINE_VERTEX_SHADER, Shaders.LINE_FRAGMENT_SHADER)

        // Generate Energy Planet UV Spheres
        val (mCount, mVerts, mNorms) = HologramGeometry.createSphere(1.15f, 28, 28)
        sphereVertCount = mCount
        sphereVertices = mVerts
        sphereNormals = mNorms

        val (cCount, cVerts, cNorms) = HologramGeometry.createSphere(0.72f, 20, 20)
        coreVertCount = cCount
        coreVertices = cVerts
        coreNormals = cNorms

        // Dual concentric orbital rings
        ring1Vertices = HologramGeometry.createOrbitalRing(1.78f, 64)
        ring2Vertices = HologramGeometry.createOrbitalRing(2.22f, 64)

        // Orbiting golden embers
        particles = HologramGeometry.createParticles(120)
    }

    override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
        GLES20.glViewport(0, 0, width, height)
        val ratio = width.toFloat() / height.toFloat()
        Matrix.perspectiveM(projectionMatrix, 0, 45.0f, ratio, 0.1f, 100.0f)
    }

    override fun onDrawFrame(gl: GL10?) {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)

        val elapsed = (SystemClock.uptimeMillis() - startTime) / 1000.0f

        // Camera View Matrix
        Matrix.setLookAtM(viewMatrix, 0, 0f, 0f, zoom, 0f, 0f, 0f, 0f, 1.0f, 0.0f)
        Matrix.multiplyMM(vPMatrix, 0, projectionMatrix, 0, viewMatrix, 0)

        // Dynamic State Parameters
        var autoSpinSpeed = 14f
        var pulse = 1.0f
        var planetScale = 1.0f
        var ring1Speed = 0.5f
        var ring2Speed = -0.65f
        var baseR = 0.96f; var baseG = 0.62f; var baseB = 0.04f

        when (state) {
            HologramState.IDLE -> {
                pulse = 1.0f + 0.06f * sin(elapsed * 1.8f)
                planetScale = 1.0f + 0.03f * sin(elapsed * 1.8f)
                autoSpinSpeed = 12f
            }
            HologramState.LISTENING -> {
                pulse = 1.35f + 0.15f * sin(elapsed * 6.0f)
                planetScale = 1.05f
                autoSpinSpeed = 24f
                ring1Speed = 1.2f
                ring2Speed = -1.5f
            }
            HologramState.THINKING -> {
                // Serious Mode: rapid plasma acceleration, bright flare
                pulse = 1.55f + 0.25f * sin(elapsed * 12.0f)
                planetScale = 1.08f + 0.04f * sin(elapsed * 8.0f)
                autoSpinSpeed = 60f
                ring1Speed = 2.8f
                ring2Speed = -3.2f
            }
            HologramState.SPEAKING -> {
                val wave = Math.abs(sin(elapsed * 4.5f))
                pulse = 1.1f + 0.35f * wave
                planetScale = 0.98f + 0.12f * wave
                autoSpinSpeed = 20f
            }
            HologramState.WORKING -> {
                pulse = 1.28f + 0.08f * sin(elapsed * 4.0f)
                planetScale = 1.03f
                autoSpinSpeed = 35f
                ring1Speed = 1.8f
                ring2Speed = -2.2f
            }
            HologramState.ERROR -> {
                // Dim warm amber glow, slow gentle oscillation
                pulse = 0.45f + 0.05f * sin(elapsed * 1.2f)
                planetScale = 0.96f
                autoSpinSpeed = 6f
                ring1Speed = 0.2f
                ring2Speed = -0.2f
                baseR = 0.65f; baseG = 0.35f; baseB = 0.08f
            }
        }

        val yaw = rotationY + (elapsed * autoSpinSpeed) % 360f

        // 1. Draw Inner Radiant Solar Core
        Matrix.setIdentityM(modelMatrix, 0)
        Matrix.rotateM(modelMatrix, 0, rotationX, 1f, 0f, 0f)
        Matrix.rotateM(modelMatrix, 0, yaw, 0f, 1f, 0f)
        Matrix.scaleM(modelMatrix, 0, planetScale * 0.95f, planetScale * 0.95f, planetScale * 0.95f)
        Matrix.multiplyMM(mvpMatrix, 0, vPMatrix, 0, modelMatrix, 0)

        drawSphereMesh(coreVertices, coreNormals, coreVertCount, mvpMatrix, modelMatrix, pulse * 1.2f, 1.0f, 0.95f, 0.85f, 0.9f)

        // 2. Draw Spherical Energy Planet Mantle
        Matrix.setIdentityM(modelMatrix, 0)
        Matrix.rotateM(modelMatrix, 0, rotationX, 1f, 0f, 0f)
        Matrix.rotateM(modelMatrix, 0, yaw, 0f, 1f, 0f)
        Matrix.scaleM(modelMatrix, 0, planetScale, planetScale, planetScale)
        Matrix.multiplyMM(mvpMatrix, 0, vPMatrix, 0, modelMatrix, 0)

        drawSphereMesh(sphereVertices, sphereNormals, sphereVertCount, mvpMatrix, modelMatrix, pulse, baseR, baseG, baseB, 0.85f)

        // 3. Draw Dual Luminous Orbital Rings
        // Ring 1 (Tilted at +26° on X)
        Matrix.setIdentityM(modelMatrix, 0)
        Matrix.rotateM(modelMatrix, 0, rotationX + 26f, 1f, 0f, 0f)
        Matrix.rotateM(modelMatrix, 0, (elapsed * ring1Speed * 50f) % 360f, 0f, 1f, 0f)
        Matrix.multiplyMM(mvpMatrix, 0, vPMatrix, 0, modelMatrix, 0)
        drawLineGeometry(ring1Vertices, mvpMatrix, floatArrayOf(0.98f, 0.75f, 0.14f, 0.85f), GLES20.GL_LINES, 128)

        // Ring 2 (Tilted at -34° on X)
        Matrix.setIdentityM(modelMatrix, 0)
        Matrix.rotateM(modelMatrix, 0, rotationX - 34f, 1f, 0f, 0f)
        Matrix.rotateM(modelMatrix, 0, (elapsed * ring2Speed * 50f) % 360f, 0f, 1f, 0f)
        Matrix.multiplyMM(mvpMatrix, 0, vPMatrix, 0, modelMatrix, 0)
        drawLineGeometry(ring2Vertices, mvpMatrix, floatArrayOf(0.96f, 0.62f, 0.04f, 0.75f), GLES20.GL_LINES, 128)

        // 4. Draw Orbiting Golden Particles
        Matrix.setIdentityM(modelMatrix, 0)
        Matrix.rotateM(modelMatrix, 0, rotationX, 1f, 0f, 0f)
        Matrix.rotateM(modelMatrix, 0, yaw * 0.5f, 0f, 1f, 0f)
        Matrix.multiplyMM(mvpMatrix, 0, vPMatrix, 0, modelMatrix, 0)
        drawLineGeometry(particles, mvpMatrix, floatArrayOf(1.0f, 0.94f, 0.6f, if (state == HologramState.ERROR) 0.4f else 0.9f), GLES20.GL_POINTS, 120)
    }

    private fun drawSphereMesh(
        verts: FloatBuffer,
        norms: FloatBuffer,
        count: Int,
        mvp: FloatArray,
        model: FloatArray,
        pulse: Float,
        r: Float,
        g: Float,
        b: Float,
        alpha: Float
    ) {
        GLES20.glUseProgram(mainProgram)

        val uMVP = GLES20.glGetUniformLocation(mainProgram, "uMVPMatrix")
        val uModel = GLES20.glGetUniformLocation(mainProgram, "uModelMatrix")
        val uBaseColor = GLES20.glGetUniformLocation(mainProgram, "uBaseColor")
        val uGlowColor = GLES20.glGetUniformLocation(mainProgram, "uGlowColor")
        val uCam = GLES20.glGetUniformLocation(mainProgram, "uCameraPos")
        val uAlpha = GLES20.glGetUniformLocation(mainProgram, "uAlpha")
        val uPulse = GLES20.glGetUniformLocation(mainProgram, "uPulse")

        val aPos = GLES20.glGetAttribLocation(mainProgram, "aPosition")
        val aNorm = GLES20.glGetAttribLocation(mainProgram, "aNormal")

        GLES20.glUniformMatrix4fv(uMVP, 1, false, mvp, 0)
        GLES20.glUniformMatrix4fv(uModel, 1, false, model, 0)
        GLES20.glUniform3f(uBaseColor, r, g, b)
        GLES20.glUniform3f(uGlowColor, 1.0f, 0.95f, 0.55f)
        GLES20.glUniform3f(uCam, 0f, 0f, zoom)
        GLES20.glUniform1f(uAlpha, alpha)
        GLES20.glUniform1f(uPulse, pulse)

        GLES20.glEnableVertexAttribArray(aPos)
        GLES20.glVertexAttribPointer(aPos, 3, GLES20.GL_FLOAT, false, 12, verts)

        GLES20.glEnableVertexAttribArray(aNorm)
        GLES20.glVertexAttribPointer(aNorm, 3, GLES20.GL_FLOAT, false, 12, norms)

        GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, count)

        GLES20.glDisableVertexAttribArray(aPos)
        GLES20.glDisableVertexAttribArray(aNorm)
    }

    private fun drawLineGeometry(buffer: FloatBuffer, mvp: FloatArray, color: FloatArray, mode: Int, count: Int) {
        GLES20.glUseProgram(lineProgram)
        val uMVP = GLES20.glGetUniformLocation(lineProgram, "uMVPMatrix")
        val uCol = GLES20.glGetUniformLocation(lineProgram, "uColor")
        val aPos = GLES20.glGetAttribLocation(lineProgram, "aPosition")

        GLES20.glUniformMatrix4fv(uMVP, 1, false, mvp, 0)
        GLES20.glUniform4fv(uCol, 1, color, 0)

        GLES20.glEnableVertexAttribArray(aPos)
        GLES20.glVertexAttribPointer(aPos, 3, GLES20.GL_FLOAT, false, 12, buffer)
        GLES20.glDrawArrays(mode, 0, count)
        GLES20.glDisableVertexAttribArray(aPos)
    }

    fun resetView() {
        rotationX = 12.0f
        rotationY = 0.0f
        zoom = 4.2f
    }

    private fun loadShader(type: Int, shaderCode: String): Int {
        return GLES20.glCreateShader(type).also { shader ->
            GLES20.glShaderSource(shader, shaderCode)
            GLES20.glCompileShader(shader)
        }
    }

    private fun createProgram(vertexCode: String, fragmentCode: String): Int {
        val vertexShader = loadShader(GLES20.GL_VERTEX_SHADER, vertexCode)
        val fragmentShader = loadShader(GLES20.GL_FRAGMENT_SHADER, fragmentCode)
        return GLES20.glCreateProgram().also { program ->
            GLES20.glAttachShader(program, vertexShader)
            GLES20.glAttachShader(program, fragmentShader)
            GLES20.glLinkProgram(program)
        }
    }
}
