"use client";
import { useState } from "react"; import { AogContactStrip } from "./AogContactStrip"; import { MobileAogBar } from "./MobileAogBar";
export function GlobalAogChrome(){const [path]=useState(()=>typeof window === "undefined" ? "/" : window.location.pathname);return <><AogContactStrip sourcePage={path}/><MobileAogBar sourcePage={path}/></>}
