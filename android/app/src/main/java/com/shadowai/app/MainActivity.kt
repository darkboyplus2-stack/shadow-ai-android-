package com.shadowai.app

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
}
