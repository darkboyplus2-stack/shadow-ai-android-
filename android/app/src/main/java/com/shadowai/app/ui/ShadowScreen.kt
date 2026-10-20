package com.shadowai.app.ui

import android.widget.Toast
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

    // Galaxy F55 display toggles
    var highRefreshRate by remember { mutableStateOf(true) }
    var bloomActive by remember { mutableStateOf(true) }

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
                            .background(
                                Brush.linearGradient(
                                    listOf(AmberPrimary, AmberSecondary)
                                )
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "●",
                            color = BlackBackground,
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp
                        )
                    }
                    Spacer(modifier = Modifier.width(10.dp))
                    Column {
                        Text(
                            text = "SHADOW AI",
                            color = TextPrimary,
                            fontWeight = FontWeight.Black,
                            fontSize = 18.sp,
                            letterSpacing = 2.sp,
                            fontFamily = FontFamily.Monospace
                        )
                        Text(
                            text = "ENERGY PLANET • GALAXY F55",
                            color = AmberPrimary,
                            fontSize = 10.sp,
                            letterSpacing = 1.sp
                        )
                    }
                }

                IconButton(
                    onClick = { showSettingsSheet = true },
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(SurfaceDark)
                        .border(1.dp, SurfaceBorder, CircleShape)
                ) {
                    Icon(
                        imageVector = Icons.Default.Settings,
                        contentDescription = "Settings",
                        tint = AmberPrimary
                    )
                }
            }
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            // 1. Central 3D Spherical Energy Planet
            HologramView(
                modifier = Modifier.fillMaxSize(),
                state = currentState,
                onViewReady = { surfaceViewRef = it }
            )

            // 2. Status Pill & State Selector
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 10.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                val stateColor by animateColorAsState(
                    targetValue = when (currentState) {
                        HologramState.IDLE -> AmberSecondary
                        HologramState.LISTENING -> AmberPrimary
                        HologramState.THINKING -> AmberGlow
                        HologramState.SPEAKING -> AmberPrimary
                        HologramState.WORKING -> AmberGlow
                        HologramState.ERROR -> Color(0xFFB45309)
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
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(stateColor)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = currentState.name,
                            color = stateColor,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.5.sp
                        )
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))

                // State Selector Pills (Horizontally scrollable for all states)
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
                                .background(if (isSelected) AmberPrimary else Color.Transparent)
                                .clickable { currentState = st }
                                .padding(horizontal = 12.dp, vertical = 6.dp)
                        ) {
                            Text(
                                text = if (st == HologramState.THINKING) "THINK" else st.name,
                                color = if (isSelected) BlackBackground else TextMuted,
                                fontSize = 11.sp,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                            )
                        }
                    }
                }
            }

            // 3. Reset View Floating Button
            SmallFloatingActionButton(
                onClick = {
                    surfaceViewRef?.renderer?.resetView()
                    Toast.makeText(context, "Energy planet perspective reset", Toast.LENGTH_SHORT).show()
                },
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .padding(end = 16.dp),
                containerColor = SurfaceDark,
                contentColor = AmberPrimary
            ) {
                Icon(
                    imageVector = Icons.Default.Refresh,
                    contentDescription = "Reset View"
                )
            }

            // 4. Bottom Controls: Chat Input & Voice Button
            Column(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(16.dp)
            ) {
                Text(
                    text = "Drag planet to rotate • Pinch to zoom • Tap states to preview",
                    color = TextHint,
                    fontSize = 11.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 10.dp)
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    OutlinedTextField(
                        value = chatText,
                        onValueChange = { chatText = it },
                        modifier = Modifier
                            .weight(1f)
                            .height(54.dp),
                        placeholder = {
                            Text(
                                text = "Ask Shadow anything…",
                                color = TextMuted,
                                fontSize = 14.sp
                            )
                        },
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedContainerColor = SurfaceDark,
                            unfocusedContainerColor = SurfaceDark,
                            focusedBorderColor = AmberPrimary,
                            unfocusedBorderColor = SurfaceBorder,
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            cursorColor = AmberPrimary
                        ),
                        shape = RoundedCornerShape(27.dp),
                        singleLine = true,
                        trailingIcon = {
                            IconButton(
                                onClick = {
                                    if (chatText.isNotBlank()) {
                                        Toast.makeText(
                                            context,
                                            "AI conversational backend connects in Milestone 2.",
                                            Toast.LENGTH_LONG
                                        ).show()
                                        chatText = ""
                                    }
                                }
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Send,
                                    contentDescription = "Send",
                                    tint = if (chatText.isNotBlank()) AmberPrimary else TextMuted
                                )
                            }
                        }
                    )

                    Box(
                        modifier = Modifier
                            .size(54.dp)
                            .clip(CircleShape)
                            .background(
                                Brush.linearGradient(
                                    listOf(AmberPrimary, AmberSecondary)
                                )
                            )
                            .clickable {
                                Toast.makeText(
                                    context,
                                    "Voice recognition module scheduled for Milestone 2.",
                                    Toast.LENGTH_LONG
                                ).show()
                            },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Mic,
                            contentDescription = "Voice Input",
                            tint = BlackBackground,
                            modifier = Modifier.size(26.dp)
                        )
                    }
                }
            }
        }
    }

    // Settings Bottom Sheet
    if (showSettingsSheet) {
        ModalBottomSheet(
            onDismissRequest = { showSettingsSheet = false },
            containerColor = SurfaceDark,
            dragHandle = { BottomSheetDefaults.DragHandle(color = AmberPrimary) }
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp, vertical = 16.dp)
            ) {
                Text(
                    text = "SHADOW AI SETTINGS",
                    color = TextPrimary,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    letterSpacing = 1.sp
                )
                Text(
                    text = "Hardware profile: Samsung Galaxy F55 5G",
                    color = TextMuted,
                    fontSize = 12.sp
                )

                Spacer(modifier = Modifier.height(20.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text("120Hz Super AMOLED Target", color = TextPrimary, fontSize = 15.sp)
                        Text("Maximize rendering framerate on Galaxy F55", color = TextMuted, fontSize = 12.sp)
                    }
                    Switch(
                        checked = highRefreshRate,
                        onCheckedChange = { highRefreshRate = it },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = BlackBackground,
                            checkedTrackColor = AmberPrimary
                        )
                    )
                }

                Spacer(modifier = Modifier.height(16.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text("Amber Solar Bloom", color = TextPrimary, fontSize = 15.sp)
                        Text("GPU additive glow pass", color = TextMuted, fontSize = 12.sp)
                    }
                    Switch(
                        checked = bloomActive,
                        onCheckedChange = { bloomActive = it },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = BlackBackground,
                            checkedTrackColor = AmberPrimary
                        )
                    )
                }

                Spacer(modifier = Modifier.height(24.dp))

                Button(
                    onClick = { showSettingsSheet = false },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = AmberPrimary)
                ) {
                    Text("Apply & Close", color = BlackBackground, fontWeight = FontWeight.Bold)
                }
                Spacer(modifier = Modifier.height(20.dp))
            }
        }
    }
}
