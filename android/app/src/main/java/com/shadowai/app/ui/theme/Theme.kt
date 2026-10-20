package com.shadowai.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val DarkColorScheme = darkColorScheme(
    primary = AmberPrimary,
    secondary = AmberSecondary,
    tertiary = AmberGlow,
    background = BlackBackground,
    surface = SurfaceDark,
    onPrimary = BlackBackground,
    onSecondary = BlackBackground,
    onTertiary = BlackBackground,
    onBackground = TextPrimary,
    onSurface = TextPrimary,
)

@Composable
fun ShadowAITheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        content = content
    )
}
