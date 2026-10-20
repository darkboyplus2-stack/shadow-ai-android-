package com.shadowai.app.hologram

object Shaders {
    // Vertex Shader: Projects spherical 3D vertices, calculates world normal and camera view vector
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

    // Fragment Shader: Glowing circular energy planet with solar corona and Fresnel atmosphere
    val FRAGMENT_SHADER = """
        precision mediump float;
        
        uniform vec3 uBaseColor;      // Golden yellow (e.g. 0.96, 0.62, 0.04)
        uniform vec3 uGlowColor;      // Bright amber/warm gold (1.0, 0.95, 0.55)
        uniform vec3 uCameraPos;
        uniform float uAlpha;
        uniform float uPulse;
        
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        
        void main() {
            vec3 normal = normalize(vNormal);
            vec3 viewDir = normalize(uCameraPos - vWorldPos);
            
            // Fresnel calculation for glowing spherical atmospheric rim
            float rim = 1.0 - max(dot(viewDir, normal), 0.0);
            float fresnel = pow(rim, 2.0);
            
            // Directional key light
            vec3 lightDir = normalize(vec3(0.5, 0.8, 0.9));
            float diff = max(dot(normal, lightDir), 0.0);
            
            // Specular highlight on smooth spherical surface
            vec3 halfDir = normalize(lightDir + viewDir);
            float spec = pow(max(dot(normal, halfDir), 0.0), 28.0);
            
            // Combine glowing core, solar plasma mantle, and bright outer corona
            vec3 finalColor = uBaseColor * (0.4 + 0.6 * diff) 
                            + (uGlowColor * fresnel * 2.2 * uPulse) 
                            + vec3(spec * 0.45);
            
            float finalAlpha = clamp(uAlpha * (0.65 + fresnel * 0.35), 0.0, 1.0);
            gl_FragColor = vec4(finalColor, finalAlpha);
        }
    """.trimIndent()

    // Particle / Ring shader
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
}
