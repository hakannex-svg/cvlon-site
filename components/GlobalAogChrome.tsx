"use client";
import { useSyncExternalStore } from "react"; import { AogContactStrip } from "./AogContactStrip"; import { MobileAogBar } from "./MobileAogBar";
const subscribe=()=>()=>{};const getPath=()=>window.location.pathname;const getServerPath=()=>"/";
export function GlobalAogChrome(){const path=useSyncExternalStore(subscribe,getPath,getServerPath),disableMobileBar=path==="/aog-services"||path==="/contact-us";return <><AogContactStrip sourcePage={path}/>{!disableMobileBar&&<MobileAogBar sourcePage={path}/>}</>}
