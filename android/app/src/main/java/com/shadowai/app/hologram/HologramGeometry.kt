package com.shadowai.app.hologram

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

    /**
     * UV Sphere generator for the Energy Planet (Mantle & Core)
     * Returns Pair(vertexCount, Pair(vertexBuffer, normalBuffer))
     */
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

                // Quad as 2 triangles (v1, v3, v2) and (v2, v3, v4)
                val quadVerts = floatArrayOf(
                    x1, y1, z1,  x3, y2, z3,  x2, y1, z2,
                    x2, y1, z2,  x3, y2, z3,  x4, y2, z4
                )

                for (i in 0 until 6) {
                    val nx = quadVerts[i * 3 + 0]
                    val ny = quadVerts[i * 3 + 1]
                    val nz = quadVerts[i * 3 + 2]

                    normals.add(nx)
                    normals.add(ny)
                    normals.add(nz)

                    vertices.add(nx * radius)
                    vertices.add(ny * radius)
                    vertices.add(nz * radius)
                }
            }
        }

        val vertCount = vertices.size / 3
        return Triple(
            vertCount,
            createFloatBuffer(vertices.toFloatArray()),
            createFloatBuffer(normals.toFloatArray())
        )
    }

    /**
     * Smooth circular orbital ring for miniature solar system
     */
    fun createOrbitalRing(radius: Float, segments: Int = 64): FloatBuffer {
        val coords = ArrayList<Float>()
        for (i in 0 until segments) {
            val a1 = (i.toDouble() / segments) * Math.PI * 2
            val a2 = ((i + 1).toDouble() / segments) * Math.PI * 2

            coords.add((cos(a1) * radius).toFloat())
            coords.add(0f)
            coords.add((sin(a1) * radius).toFloat())

            coords.add((cos(a2) * radius).toFloat())
            coords.add(0f)
            coords.add((sin(a2) * radius).toFloat())
        }
        return createFloatBuffer(coords.toFloatArray())
    }

    /**
     * Orbiting golden particle swarm
     */
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
}
