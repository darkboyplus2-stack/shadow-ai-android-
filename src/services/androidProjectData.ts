import JSZip from 'jszip';
import { AndroidProjectFile } from '../types/hologram';

export const ANDROID_FILES: AndroidProjectFile[] = [
  {
    path: 'app/src/main/java/com/shadowai/app/hologram/HologramRenderer.kt',
    category: 'OpenGL ES',
    description: 'Native OpenGL ES 2.0/3.0 renderer with golden-amber spherical energy planet, solar corona Fresnel shaders, and dual inclined orbital rings.',
    content: `package com.shadowai.app.hologram

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
    private val vPMatrix = FloatArray(16)
    private val projectionMatrix = FloatArray(16)
    private val viewMatrix = FloatArray(16)
    private val modelMatrix = FloatArray(16)
    private val mvpMatrix = FloatArray(16)

    private var mainProgram = 0
    private var lineProgram = 0

    private var sphereVertCount = 0
    private lateinit var sphereVertices: FloatBuffer
    private lateinit var sphereNormals: FloatBuffer

    private var coreVertCount = 0
    private lateinit var coreVertices: FloatBuffer
    private lateinit var coreNormals: FloatBuffer

    private lateinit var ring1Vertices: FloatBuffer
    private lateinit var ring2Vertices: FloatBuffer
    private lateinit var particles: FloatBuffer

    @Volatile var state: HologramState = HologramState.IDLE
    @Volatile var rotationX = 12.0f
    @Volatile var rotationY = 0.0f
    @Volatile var zoom = 4.2f

    private var startTime = SystemClock.uptimeMillis()

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        GLES20.glClearColor(0.018f, 0.018f, 0.026f, 1.0f)
        GLES20.glEnable(GLES20.GL_DEPTH_TEST)
        GLES20.glDepthFunc(GLES20.GL_LEQUAL)

        GLES20.glEnable(GLES20.GL_BLEND)
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE)

        mainProgram = createProgram(Shaders.VERTEX_SHADER, Shaders.FRAGMENT_SHADER)
        lineProgram = createProgram(Shaders.LINE_VERTEX_SHADER, Shaders.LINE_FRAGMENT_SHADER)

        val (mCount, mVerts, mNorms) = HologramGeometry.createSphere(1.15f, 28, 28)
        sphereVertCount = mCount
        sphereVertices = mVerts
        sphereNormals = mNorms

        val (cCount, cVerts, cNorms) = HologramGeometry.createSphere(0.72f, 20, 20)
        coreVertCount = cCount
        coreVertices = cVerts
        coreNormals = cNorms

        ring1Vertices = HologramGeometry.createOrbitalRing(1.78f, 64)
        ring2Vertices = HologramGeometry.createOrbitalRing(2.22f, 64)
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

        Matrix.setLookAtM(viewMatrix, 0, 0f, 0f, zoom, 0f, 0f, 0f, 0f, 1.0f, 0.0f)
        Matrix.multiplyMM(vPMatrix, 0, projectionMatrix, 0, viewMatrix, 0)

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
                pulse = 0.45f + 0.05f * sin(elapsed * 1.2f)
                planetScale = 0.96f
                autoSpinSpeed = 6f
                ring1Speed = 0.2f
                ring2Speed = -0.2f
                baseR = 0.65f; baseG = 0.35f; baseB = 0.08f
            }
        }

        val yaw = rotationY + (elapsed * autoSpinSpeed) % 360f

        // Draw Core
        Matrix.setIdentityM(modelMatrix, 0)
        Matrix.rotateM(modelMatrix, 0, rotationX, 1f, 0f, 0f)
        Matrix.rotateM(modelMatrix, 0, yaw, 0f, 1f, 0f)
        Matrix.scaleM(modelMatrix, 0, planetScale * 0.95f, planetScale * 0.95f, planetScale * 0.95f)
        Matrix.multiplyMM(mvpMatrix, 0, vPMatrix, 0, modelMatrix, 0)
        drawSphereMesh(coreVertices, coreNormals, coreVertCount, mvpMatrix, modelMatrix, pulse * 1.2f, 1.0f, 0.95f, 0.85f, 0.9f)

        // Draw Mantle
        Matrix.setIdentityM(modelMatrix, 0)
        Matrix.rotateM(modelMatrix, 0, rotationX, 1f, 0f, 0f)
        Matrix.rotateM(modelMatrix, 0, yaw, 0f, 1f, 0f)
        Matrix.scaleM(modelMatrix, 0, planetScale, planetScale, planetScale)
        Matrix.multiplyMM(mvpMatrix, 0, vPMatrix, 0, modelMatrix, 0)
        drawSphereMesh(sphereVertices, sphereNormals, sphereVertCount, mvpMatrix, modelMatrix, pulse, baseR, baseG, baseB, 0.85f)

        // Draw Ring 1 (Tilted +26°)
        Matrix.setIdentityM(modelMatrix, 0)
        Matrix.rotateM(modelMatrix, 0, rotationX + 26f, 1f, 0f, 0f)
        Matrix.rotateM(modelMatrix, 0, (elapsed * ring1Speed * 50f) % 360f, 0f, 1f, 0f)
        Matrix.multiplyMM(mvpMatrix, 0, vPMatrix, 0, modelMatrix, 0)
        drawLineGeometry(ring1Vertices, mvpMatrix, floatArrayOf(0.98f, 0.75f, 0.14f, 0.85f), GLES20.GL_LINES, 128)

        // Draw Ring 2 (Tilted -34°)
        Matrix.setIdentityM(modelMatrix, 0)
        Matrix.rotateM(modelMatrix, 0, rotationX - 34f, 1f, 0f, 0f)
        Matrix.rotateM(modelMatrix, 0, (elapsed * ring2Speed * 50f) % 360f, 0f, 1f, 0f)
        Matrix.multiplyMM(mvpMatrix, 0, vPMatrix, 0, modelMatrix, 0)
        drawLineGeometry(ring2Vertices, mvpMatrix, floatArrayOf(0.96f, 0.62f, 0.04f, 0.75f), GLES20.GL_LINES, 128)

        // Draw Particles
        Matrix.setIdentityM(modelMatrix, 0)
        Matrix.rotateM(modelMatrix, 0, rotationX, 1f, 0f, 0f)
        Matrix.rotateM(modelMatrix, 0, yaw * 0.5f, 0f, 1f, 0f)
        Matrix.multiplyMM(mvpMatrix, 0, vPMatrix, 0, modelMatrix, 0)
        drawLineGeometry(particles, mvpMatrix, floatArrayOf(1.0f, 0.94f, 0.6f, if (state == HologramState.ERROR) 0.4f else 0.9f), GLES20.GL_POINTS, 120)
    }

    private fun drawSphereMesh(verts: FloatBuffer, norms: FloatBuffer, count: Int, mvp: FloatArray, model: FloatArray, pulse: Float, r: Float, g: Float, b: Float, alpha: Float) {
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
}`
  },
  {
    path: 'app/src/main/java/com/shadowai/app/hologram/HologramGeometry.kt',
    category: 'OpenGL ES',
    description: 'UV Sphere and orbital ring geometry generation for the spherical energy planet.',
    content: `package com.shadowai.app.hologram

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import kotlin.math.cos
import kotlin.math.sin

object HologramGeometry {
    fun createFloatBuffer(coords: FloatArray): FloatBuffer {
        return ByteBuffer.allocateDirect(coords.size * 4).run {
            order(ByteOrder.nativeOrder())
            asFloatBuffer().apply {
                put(coords)
                position(0)
            }
        }
    }

    fun createSphere(radius: Float, rings: Int = 32, sectors: Int = 32): Triple<Int, FloatBuffer, FloatBuffer> {
        val R = 1f / rings.toFloat()
        val S = 1f / sectors.toFloat()
        val vertices = ArrayList<Float>()
        val normals = ArrayList<Float>()

        for (r in 0 until rings) {
            for (s in 0 until sectors) {
                val y1 = sin(-Math.PI / 2 + Math.PI * r * R).toFloat()
                val y2 = sin(-Math.PI / 2 + Math.PI * (r + 1) * R).toFloat()
                val cosR1 = cos(-Math.PI / 2 + Math.PI * r * R).toFloat()
                val cosR2 = cos(-Math.PI / 2 + Math.PI * (r + 1) * R).toFloat()

                val x1 = cos(2 * Math.PI * s * S).toFloat() * cosR1
                val z1 = sin(2 * Math.PI * s * S).toFloat() * cosR1
                val x2 = cos(2 * Math.PI * (s + 1) * S).toFloat() * cosR1
                val z2 = sin(2 * Math.PI * (s + 1) * S).toFloat() * cosR1
                val x3 = cos(2 * Math.PI * s * S).toFloat() * cosR2
                val z3 = sin(2 * Math.PI * s * S).toFloat() * cosR2
                val x4 = cos(2 * Math.PI * (s + 1) * S).toFloat() * cosR2
                val z4 = sin(2 * Math.PI * (s + 1) * S).toFloat() * cosR2

                val quadVerts = floatArrayOf(
                    x1, y1, z1,  x3, y2, z3,  x2, y1, z2,
                    x2, y1, z2,  x3, y2, z3,  x4, y2, z4
                )

                for (i in 0 until 6) {
                    val nx = quadVerts[i * 3 + 0]
                    val ny = quadVerts[i * 3 + 1]
                    val nz = quadVerts[i * 3 + 2]
                    normals.add(nx); normals.add(ny); normals.add(nz)
                    vertices.add(nx * radius); vertices.add(ny * radius); vertices.add(nz * radius)
                }
            }
        }

        val vertCount = vertices.size / 3
        return Triple(vertCount, createFloatBuffer(vertices.toFloatArray()), createFloatBuffer(normals.toFloatArray()))
    }

    fun createOrbitalRing(radius: Float, segments: Int = 64): FloatBuffer {
        val coords = ArrayList<Float>()
        for (i in 0 until segments) {
            val a1 = (i.toDouble() / segments) * Math.PI * 2
            val a2 = ((i + 1).toDouble() / segments) * Math.PI * 2
            coords.add((cos(a1) * radius).toFloat()); coords.add(0f); coords.add((sin(a1) * radius).toFloat())
            coords.add((cos(a2) * radius).toFloat()); coords.add(0f); coords.add((sin(a2) * radius).toFloat())
        }
        return createFloatBuffer(coords.toFloatArray())
    }

    fun createParticles(count: Int = 120): FloatBuffer {
        val coords = FloatArray(count * 3)
        for (i in 0 until count) {
            val angle = Math.random() * Math.PI * 2
            val r = 1.35 + Math.random() * 1.4
            val y = (Math.random() - 0.5) * 1.5
            coords[i * 3 + 0] = (cos(angle) * r).toFloat()
            coords[i * 3 + 1] = y.toFloat()
            coords[i * 3 + 2] = (sin(angle) * r).toFloat()
        }
        return createFloatBuffer(coords)
    }
}`
  },
  {
    path: 'app/src/main/java/com/shadowai/app/ui/ShadowScreen.kt',
    category: 'Compose UI',
    description: 'Jetpack Compose UI with white energy core theme, native Android SpeechRecognizer integration, audio permissions, and review/edit chat bar.',
    content: `package com.shadowai.app.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.shadowai.app.hologram.HologramRenderer
import com.shadowai.app.hologram.HologramState
import com.shadowai.app.hologram.HologramSurfaceView
import com.shadowai.app.hologram.HologramView
import com.shadowai.app.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShadowScreen() {
    val context = LocalContext.current
    var currentState by remember { mutableStateOf(HologramState.IDLE) }
    var chatText by remember { mutableStateOf("") }
    var surfaceViewRef by remember { mutableStateOf<HologramSurfaceView?>(null) }
    var showSettingsSheet by remember { mutableStateOf(false) }
    var isListening by remember { mutableStateOf(false) }

    val speechRecognizer = remember {
        if (SpeechRecognizer.isRecognitionAvailable(context)) {
            SpeechRecognizer.createSpeechRecognizer(context)
        } else null
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            Toast.makeText(context, "Microphone permission granted. Tap mic to speak.", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(context, "Microphone permission denied. Enable in Android settings to use voice input.", Toast.LENGTH_LONG).show()
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            speechRecognizer?.destroy()
        }
    }

    fun startListening() {
        if (speechRecognizer == null) {
            Toast.makeText(context, "Speech recognition service unavailable on device", Toast.LENGTH_SHORT).show()
            return
        }

        val hasPermission = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED

        if (!hasPermission) {
            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
            return
        }

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US")
        }

        speechRecognizer.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
                isListening = true
                currentState = HologramState.LISTENING
                Toast.makeText(context, "Shadow is listening… Speak clearly", Toast.LENGTH_SHORT).show()
            }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {
                isListening = false
                currentState = HologramState.IDLE
            }
            override fun onError(error: Int) {
                isListening = false
                currentState = HologramState.IDLE
                val msg = when (error) {
                    SpeechRecognizer.ERROR_NO_MATCH -> "No speech detected. Please speak closer to mic."
                    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Speech input timed out."
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission required."
                    else -> "Speech recognition notice ($error)"
                }
                Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
            }
            override fun onResults(results: Bundle?) {
                isListening = false
                currentState = HologramState.IDLE
                val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                if (!matches.isNullOrEmpty()) {
                    val recognized = matches[0]
                    chatText = if (chatText.isNotBlank()) "$chatText $recognized" else recognized
                    Toast.makeText(context, "Speech recognized! Review text or tap Send.", Toast.LENGTH_SHORT).show()
                }
            }
            override fun onPartialResults(partialResults: Bundle?) {
                val partials = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                if (!partials.isNullOrEmpty()) {
                    // Interim partial results preview
                }
            }
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })

        speechRecognizer.startListening(intent)
    }

    Scaffold(
        containerColor = BlackBackground,
        topBar = {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(28.dp)
                            .clip(CircleShape)
                            .background(Brush.linearGradient(listOf(WhitePrimary, SilverSecondary))),
                        contentAlignment = Alignment.Center
                    ) {
                        Text("●", color = BlackBackground, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    }
                    Spacer(modifier = Modifier.width(10.dp))
                    Column {
                        Text("SHADOW AI", color = TextPrimary, fontWeight = FontWeight.Black, fontSize = 18.sp, letterSpacing = 2.sp, fontFamily = FontFamily.Monospace)
                        Text("WHITE ENERGY CORE • GALAXY F55", color = SilverSecondary, fontSize = 10.sp, letterSpacing = 1.sp)
                    }
                }

                IconButton(
                    onClick = { showSettingsSheet = true },
                    modifier = Modifier.size(40.dp).clip(CircleShape).background(SurfaceDark).border(1.dp, SurfaceBorder, CircleShape)
                ) {
                    Icon(Icons.Default.Settings, contentDescription = "Settings", tint = WhitePrimary)
                }
            }
        }
    ) { innerPadding ->
        Box(modifier = Modifier.fillMaxSize().padding(innerPadding)) {
            // Central 3D Spherical White Energy Core
            HologramView(modifier = Modifier.fillMaxSize(), state = currentState, onViewReady = { surfaceViewRef = it })

            // Status Badge & State Selector
            Column(
                modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                val stateColor by animateColorAsState(
                    targetValue = when (currentState) {
                        HologramState.IDLE -> SilverSecondary
                        HologramState.LISTENING -> WhitePrimary
                        HologramState.THINKING -> WhiteCoreGlow
                        HologramState.SPEAKING -> WhitePrimary
                        HologramState.WORKING -> WhiteCoreGlow
                        HologramState.ERROR -> Color(0xFFEF4444)
                    },
                    animationSpec = tween(350)
                )

                Surface(
                    color = SurfaceDark.copy(alpha = 0.85f),
                    shape = RoundedCornerShape(20.dp),
                    border = androidx.compose.foundation.BorderStroke(1.dp, stateColor.copy(alpha = 0.45f)),
                    shadowElevation = 8.dp
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(modifier = Modifier.size(8.dp).clip(CircleShape).background(stateColor))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(currentState.name, color = stateColor, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))

                Row(
                    modifier = Modifier
                        .padding(horizontal = 16.dp)
                        .clip(RoundedCornerShape(24.dp))
                        .background(SurfaceDark.copy(alpha = 0.75f))
                        .border(1.dp, SurfaceBorder, RoundedCornerShape(24.dp))
                        .padding(4.dp)
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    HologramState.values().forEach { st ->
                        val isSelected = currentState == st
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(18.dp))
                                .background(if (isSelected) WhitePrimary else Color.Transparent)
                                .clickable { currentState = st }
                                .padding(horizontal = 12.dp, vertical = 6.dp)
                        ) {
                            Text(if (st == HologramState.THINKING) "THINK" else st.name, color = if (isSelected) BlackBackground else TextMuted, fontSize = 11.sp, fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal)
                        }
                    }
                }
            }

            // Reset View Button
            SmallFloatingActionButton(
                onClick = {
                    surfaceViewRef?.renderer?.resetView()
                    Toast.makeText(context, "Energy core perspective reset", Toast.LENGTH_SHORT).show()
                },
                modifier = Modifier.align(Alignment.CenterEnd).padding(end = 16.dp),
                containerColor = SurfaceDark,
                contentColor = WhitePrimary
            ) {
                Icon(Icons.Default.Refresh, contentDescription = "Reset View")
            }

            // Bottom Chat & Mic
            Column(
                modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().padding(16.dp)
            ) {
                Text("Drag core to rotate • Pinch to zoom • Tap mic to speak", color = TextHint, fontSize = 11.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp))
                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        value = chatText,
                        onValueChange = { chatText = it },
                        modifier = Modifier.weight(1f).height(54.dp),
                        placeholder = { Text(if (isListening) "Listening… Speak now" else "Ask Shadow in English, Hindi…", color = TextMuted, fontSize = 14.sp) },
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedContainerColor = SurfaceDark, unfocusedContainerColor = SurfaceDark,
                            focusedBorderColor = WhitePrimary, unfocusedBorderColor = SurfaceBorder,
                            focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary, cursorColor = WhitePrimary
                        ),
                        shape = RoundedCornerShape(27.dp),
                        singleLine = true,
                        trailingIcon = {
                            IconButton(onClick = {
                                if (chatText.isNotBlank()) {
                                    Toast.makeText(context, "Shadow query submitted: $chatText", Toast.LENGTH_SHORT).show()
                                    chatText = ""
                                }
                            }) {
                                Icon(Icons.Default.Send, contentDescription = "Send", tint = if (chatText.isNotBlank()) WhitePrimary else TextMuted)
                            }
                        }
                    )

                    Box(
                        modifier = Modifier
                            .size(54.dp)
                            .clip(CircleShape)
                            .background(
                                if (isListening) Brush.linearGradient(listOf(Color(0xFFEF4444), Color(0xFFDC2626)))
                                else Brush.linearGradient(listOf(WhitePrimary, SilverSecondary))
                            )
                            .clickable {
                                if (isListening) {
                                    speechRecognizer?.stopListening()
                                    isListening = false
                                    currentState = HologramState.IDLE
                                } else {
                                    startListening()
                                }
                            },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            if (isListening) Icons.Default.MicOff else Icons.Default.Mic,
                            contentDescription = "Voice Input",
                            tint = if (isListening) WhitePrimary else BlackBackground,
                            modifier = Modifier.size(26.dp)
                        )
                    }
                }
            }
        }
    }
}`
  },
  {
    path: 'app/src/main/java/com/shadowai/app/MainActivity.kt',
    category: 'Kotlin',
    description: 'Main Android activity with Jetpack Compose theme and edge-to-edge system bar rendering.',
    content: `package com.shadowai.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.shadowai.app.ui.ShadowScreen
import com.shadowai.app.ui.theme.ShadowAITheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            ShadowAITheme {
                ShadowScreen()
            }
        }
    }
}`
  },
  {
    path: 'app/build.gradle.kts',
    category: 'Gradle',
    description: 'Android application build script with Compose 2.0, SDK 35, and Samsung Galaxy F55 ARM64 optimization.',
    content: `plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.shadowai.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.shadowai.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }

        ndk {
            abiFilters.addAll(listOf("arm64-v8a", "armeabi-v7a", "x86_64"))
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("debug")
        }
        debug {
            applicationIdSuffix = ".debug"
            isDebuggable = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
}`
  },
  {
    path: '.github/workflows/build-apk.yml',
    category: 'Workflow',
    description: 'GitHub Actions workflow that builds the debug APK in the cloud so you can install it on your phone with zero PC requirement.',
    content: `name: Build Shadow AI Android APK

on:
  push:
    branches: [ main, master ]
  workflow_dispatch:

jobs:
  build:
    name: Build Android APK
    runs-on: ubuntu-latest

    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
          cache: gradle

      - name: Grant execute permission for gradlew
        run: |
          if [ -f "android/gradlew" ]; then
            chmod +x android/gradlew
          fi

      - name: Build Debug APK
        working-directory: ./android
        run: |
          if [ -f "./gradlew" ]; then
            ./gradlew assembleDebug --stacktrace
          else
            gradle assembleDebug --stacktrace
          fi

      - name: Upload APK Artifact
        uses: actions/upload-artifact@v4
        with:
          name: shadow-ai-debug-apk
          path: android/app/build/outputs/apk/debug/*.apk
          retention-days: 14`
  },
  {
    path: 'app/src/main/AndroidManifest.xml',
    category: 'Manifest',
    description: 'Android manifest declaring OpenGL ES 2.0+ requirement, hardware acceleration, and audio permissions.',
    content: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-feature
        android:glEsVersion="0x00020000"
        android:required="true" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.VIBRATE" />

    <application
        android:allowBackup="true"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/Theme.ShadowAI"
        android:hardwareAccelerated="true">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|screenLayout|keyboardHidden"
            android:screenOrientation="portrait"
            android:theme="@style/Theme.ShadowAI">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>`
  }
];

/**
 * Packs all native Android files into a ZIP and triggers browser download
 */
export async function downloadAndroidProjectZip(): Promise<void> {
  const zip = new JSZip();
  const folder = zip.folder('shadow-ai-android');

  if (!folder) return;

  for (const file of ANDROID_FILES) {
    folder.file(file.path, file.content);
  }

  // Add adaptive icon and resources
  folder.file('app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml', `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/black" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>`);

  folder.file('app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml', `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/black" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>`);

  folder.file('app/src/main/res/drawable/ic_launcher_foreground.xml', `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:strokeColor="#D97706"
        android:strokeWidth="2.5"
        android:pathData="M18,60 C26,40 82,24 90,48 C98,72 42,88 18,60 Z" />
    <path
        android:strokeColor="#F59E0B"
        android:strokeWidth="2.0"
        android:pathData="M24,46 C32,28 76,40 84,62 C92,84 48,72 24,46 Z" />
    <path
        android:fillColor="#78350F"
        android:pathData="M54,54 m-28,0 a28,28 0 1,0 56,0 a28,28 0 1,0 -56,0" />
    <path
        android:fillColor="#F59E0B"
        android:pathData="M54,54 m-22,0 a22,22 0 1,0 44,0 a22,22 0 1,0 -44,0" />
    <path
        android:fillColor="#FEF08A"
        android:pathData="M54,54 m-13,0 a13,13 0 1,0 26,0 a13,13 0 1,0 -26,0" />
    <path
        android:fillColor="#FFFBEB"
        android:pathData="M54,54 m-6,0 a6,6 0 1,0 12,0 a6,6 0 1,0 -12,0" />
</vector>`);

  folder.file('app/src/main/res/values/strings.xml', `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">SHADOW AI</string>
    <string name="hologram_desc">Glowing Energy Planet Hologram</string>
</resources>`);

  folder.file('app/src/main/res/values/colors.xml', `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="black">#FF050507</color>
    <color name="surface_dark">#FF0E0E14</color>
    <color name="amber_primary">#FFF59E0B</color>
    <color name="amber_secondary">#FFD97706</color>
    <color name="amber_light">#FFFEF08A</color>
</resources>`);

  folder.file('app/src/main/res/values/themes.xml', `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.ShadowAI" parent="android:Theme.Material.NoActionBar">
        <item name="android:statusBarColor">#FF050507</item>
        <item name="android:navigationBarColor">#FF050507</item>
        <item name="android:windowBackground">#FF050507</item>
    </style>
</resources>`);

  folder.file('app/src/main/java/com/shadowai/app/ui/theme/Color.kt', `package com.shadowai.app.ui.theme
import androidx.compose.ui.graphics.Color
val BlackBackground = Color(0xFF020204)
val SurfaceDark = Color(0xFF090B14)
val SurfaceBorder = Color(0xFF1E293B)
val WhitePrimary = Color(0xFFFFFFFF)
val SilverSecondary = Color(0xFFCBD5E1)
val WhiteCoreGlow = Color(0xFFF8FAFC)
val AmberPrimary = Color(0xFFFFFFFF)
val AmberSecondary = Color(0xFFCBD5E1)
val AmberGlow = Color(0xFFF8FAFC)
val TextPrimary = Color(0xFFFFFFFF)
val TextMuted = Color(0xFF94A3B8)
val TextHint = Color(0xFF64748B)`);

  folder.file('app/src/main/java/com/shadowai/app/ui/theme/Theme.kt', `package com.shadowai.app.ui.theme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
private val DarkColorScheme = darkColorScheme(
    primary = WhitePrimary, secondary = SilverSecondary, tertiary = WhiteCoreGlow,
    background = BlackBackground, surface = SurfaceDark, onPrimary = BlackBackground,
    onSecondary = BlackBackground, onTertiary = BlackBackground, onBackground = TextPrimary, onSurface = TextPrimary
)
@Composable
fun ShadowAITheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = DarkColorScheme, content = content)
}`);

  folder.file('app/src/main/java/com/shadowai/app/hologram/Shaders.kt', `package com.shadowai.app.hologram
object Shaders {
    val VERTEX_SHADER = """
        uniform mat4 uMVPMatrix;
        uniform mat4 uModelMatrix;
        attribute vec4 aPosition;
        attribute vec3 aNormal;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
            vec4 worldPos = uModelMatrix * aPosition;
            vWorldPos = worldPos.xyz;
            vNormal = normalize(vec3(uModelMatrix * vec4(aNormal, 0.0)));
            gl_Position = uMVPMatrix * aPosition;
        }
    """.trimIndent()

    val FRAGMENT_SHADER = """
        precision mediump float;
        uniform vec3 uBaseColor;
        uniform vec3 uGlowColor;
        uniform vec3 uCameraPos;
        uniform float uAlpha;
        uniform float uPulse;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
            vec3 normal = normalize(vNormal);
            vec3 viewDir = normalize(uCameraPos - vWorldPos);
            float rim = 1.0 - max(dot(viewDir, normal), 0.0);
            float fresnel = pow(rim, 2.0);
            vec3 lightDir = normalize(vec3(0.5, 0.8, 0.9));
            float diff = max(dot(normal, lightDir), 0.0);
            vec3 halfDir = normalize(lightDir + viewDir);
            float spec = pow(max(dot(normal, halfDir), 0.0), 28.0);
            vec3 finalColor = uBaseColor * (0.4 + 0.6 * diff) + (uGlowColor * fresnel * 2.2 * uPulse) + vec3(spec * 0.45);
            float finalAlpha = clamp(uAlpha * (0.65 + fresnel * 0.35), 0.0, 1.0);
            gl_FragColor = vec4(finalColor, finalAlpha);
        }
    """.trimIndent()

    val LINE_VERTEX_SHADER = """
        uniform mat4 uMVPMatrix;
        attribute vec4 aPosition;
        void main() {
            gl_Position = uMVPMatrix * aPosition;
            gl_PointSize = 4.5;
        }
    """.trimIndent()

    val LINE_FRAGMENT_SHADER = """
        precision mediump float;
        uniform vec4 uColor;
        void main() {
            gl_FragColor = uColor;
        }
    """.trimIndent()
}`);

  folder.file('gradle/wrapper/gradle-wrapper.properties', `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.7-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists`);

  folder.file('gradle.properties', `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
android.nonTransitiveRClass=true
kotlin.code.style=official`);

  folder.file('settings.gradle.kts', `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "ShadowAI"
include(":app")`);

  folder.file('build.gradle.kts', `plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
}`);

  folder.file('gradle/libs.versions.toml', `[versions]
agp = "8.5.0"
kotlin = "2.0.0"
coreKtx = "1.13.1"
lifecycleRuntimeKtx = "2.8.2"
activityCompose = "1.9.0"
composeBom = "2024.06.00"
material3 = "1.2.1"
materialIconsExtended = "1.6.8"

[libraries]
androidx-core-ktx = { group = "androidx.core", name = "core-ktx", version.ref = "coreKtx" }
androidx-lifecycle-runtime-ktx = { group = "androidx.lifecycle", name = "lifecycle-runtime-ktx", version.ref = "lifecycleRuntimeKtx" }
androidx-activity-compose = { group = "androidx.activity", name = "activity-compose", version.ref = "activityCompose" }
androidx-compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "composeBom" }
androidx-ui = { group = "androidx.compose.ui", name = "ui" }
androidx-ui-graphics = { group = "androidx.compose.ui", name = "ui-graphics" }
androidx-ui-tooling-preview = { group = "androidx.compose.ui", name = "ui-tooling-preview" }
androidx-material3 = { group = "androidx.compose.material3", name = "material3", version.ref = "material3" }
androidx-material-icons-extended = { group = "androidx.compose.material", name = "material-icons-extended", version.ref = "materialIconsExtended" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }`);

  folder.file('README.md', `# SHADOW AI Android Project (Energy Planet Edition)
Native Android Kotlin + Jetpack Compose app with OpenGL ES 2.0/3.0 spherical energy planet hologram.`);

  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'shadow-ai-android-project.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
