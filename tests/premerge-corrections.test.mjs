import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root=path.resolve(import.meta.dirname,"..");
const read=(...parts)=>fs.readFileSync(path.join(root,...parts),"utf8");

test("mobile AOG bar uses route exclusions and reversible intersection suppression",()=>{
 const globalChrome=read("components","GlobalAogChrome.tsx"),bar=read("components","MobileAogBar.tsx"),interior=read("components","Interior.tsx"),home=read("app","page.tsx"),css=read("app","globals.css");
 assert.match(globalChrome,/path==="\/aog-services"\|\|path==="\/contact-us"/);
 assert.match(globalChrome,/!disableMobileBar&&<MobileAogBar/);
 assert.match(interior,/data-mobile-aog-suppress/);assert.match(home,/data-mobile-aog-suppress/);
 assert.match(bar,/IntersectionObserver/);assert.match(bar,/setObscured\(visible\.size>0\)/);
 for(const selector of [".aog-band","footer",".prominent-aog-actions"])assert.match(bar,new RegExp(selector.replace(".","\\.")));
 assert.match(bar,/civilon:mobile-menu/);assert.match(bar,/focusin/);assert.match(bar,/input,select,textarea/);
 assert.match(bar,/aria-hidden=\{hidden\}/);assert.match(bar,/inert=\{hidden\?true:undefined\}/);
 assert.match(css,/mobile-urgent\.is-suppressed[^}]*visibility:hidden[^}]*pointer-events:none/);
 assert.doesNotMatch(css,/footer[^}]*padding-bottom[^}]*68px/);
});

test("approved customer-facing quality and documentation copy is present",()=>{
 const quality=read("app","quality-assurance","page.tsx"),home=read("app","page.tsx");
 assert.doesNotMatch(quality,/Public content|not represented as an industry certification/i);
 assert.match(quality,/Civilon documents discrepancies and escalates them for review\. The quotation and governing terms state the applicable quarantine, return, warranty or remedy path\./);
 assert.match(home,/FAA 8130-3 \/ EASA Form 1 where applicable/);
});

test("the shared RFQ form resolves the approved contextual presentation labels",()=>{
 const form=read("components","RfqForm.tsx");
 assert.match(form,/actionLabel\?: string/);
 for(const label of ["Request a Part","Start an AOG request","Start a repair request","Start a documentation request","Send an RFQ"])assert.match(form,new RegExp(label));
 assert.equal((form.match(/export function RfqForm/g)||[]).length,1);
});
