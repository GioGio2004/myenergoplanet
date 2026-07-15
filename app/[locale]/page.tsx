"use client";

import dynamic from "next/dynamic";

const View3D = dynamic(() => import("@/components/View3D"), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center w-full h-full text-white">Loading 3D Environment...</div>
});

export default function Home() {
  return (
    <main style={{ width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#080c12" }}>
      <View3D />
    </main>
  );
}
