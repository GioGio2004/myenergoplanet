import React, { useRef } from 'react'
import { useGLTF, useAnimations } from '@react-three/drei'

export function House(props: any) {
  const group = useRef<any>(null)
  const { nodes, materials, animations } = useGLTF('/rts_human_house_lv2_-_proto_series-transformed.glb') as any
  const { actions } = useAnimations(animations, group)
  
  return (
    <group ref={group} {...props} dispose={null}>
      <group name="Sketchfab_Scene">
        <group name="RootNode" scale={0.01}>
          <group name="house_Lv2_door" position={[43.239, 249.975, 257.245]}>
            <group name="house_Lv2_door_handler" position={[-76.282, -4.416, 5.378]} rotation={[-1.573, 0, 0]}>
              <mesh name="house_Lv2_door_handler_proto_human_rts_0" geometry={nodes.house_Lv2_door_handler_proto_human_rts_0.geometry} material={materials.proto_human_rts} castShadow receiveShadow />
            </group>
            <mesh name="house_Lv2_door_proto_human_rts_0" geometry={nodes.house_Lv2_door_proto_human_rts_0.geometry} material={materials.proto_human_rts} castShadow receiveShadow />
          </group>
        </group>
        <mesh name="house_Lv2_proto_human_rts_0" geometry={nodes.house_Lv2_proto_human_rts_0.geometry} material={materials.proto_human_rts} scale={0.01} castShadow receiveShadow />
      </group>
    </group>
  )
}

useGLTF.preload('/rts_human_house_lv2_-_proto_series-transformed.glb')
