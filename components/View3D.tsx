"use client";

import { Canvas } from "@react-three/fiber";
import { OrthographicCamera } from "@react-three/drei";
import { Hero } from "@/components/Hero";

export default function View3D() {
  return (
    <Canvas shadows>
      <OrthographicCamera
        makeDefault
        position={[10, 10, 10]}
        zoom={50} // Adjust for "Clash of Clans" style scale
        near={-100}
        far={100}
      />
      
      <ambientLight intensity={0.5} />
      <directionalLight 
        position={[10, 20, 5]} 
        intensity={1.5} 
        castShadow 
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />

      <Hero />

      <mesh 
        rotation={[-Math.PI / 2, 0, 0]} 
        position={[0, -0.01, 0]}
        receiveShadow
      >
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial color="#2d3748" />
      </mesh>
      
      <gridHelper args={[100, 100, 0x4a5568, 0x1a202c]} position={[0, 0, 0]} />
    </Canvas>
  );
}
