import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root=path.resolve(import.meta.dirname,"..");
const read=(...parts)=>fs.readFileSync(path.join(root,...parts),"utf8");

test("release environment is documented and production metadata fails closed",()=>{
 const example=read(".env.example"),config=read("lib","site-config.ts"),robots=read("app","robots.ts"),metadata=read("lib","metadata.ts"),layout=read("app","layout.tsx");
 assert.match(example,/NEXT_PUBLIC_SITE_URL=https:\/\/cvlon\.com/);assert.match(example,/NEXT_PUBLIC_ALLOW_INDEXING=false/);
 assert.match(config,/NEXT_PUBLIC_SITE_URL is required for production builds/);
 assert.match(config,/productionOrigin = "https:\/\/cvlon\.com"/);
 assert.match(config,/configuredSiteUrl !== productionOrigin/);
 assert.match(robots,/NEXT_PUBLIC_ALLOW_INDEXING==="true"/);assert.match(metadata,/NEXT_PUBLIC_ALLOW_INDEXING === "true"/);assert.match(layout,/alternates: \{ canonical: "\/" \}/);assert.match(layout,/NEXT_PUBLIC_ALLOW_INDEXING === "true"/);
});

test("canonical host and optional www redirect are fixed to the approved apex origin",()=>{
 const interior=read("components","Interior.tsx"),netlify=read("netlify.toml");
 assert.match(interior,/new URL\(x\.href\|\|currentPath,siteConfig\.url\)/);
 assert.match(netlify,/from = "https:\/\/www\.cvlon\.com\/\*"/);
 assert.match(netlify,/to = "https:\/\/cvlon\.com\/:splat"/);
 assert.match(netlify,/status = 301/);
});

test("Netlify form contract remains one shared non-sensitive implementation",()=>{
 const form=read("components","RfqForm.tsx"),staticForm=read("public","netlify-form.html"),analytics=read("lib","analytics.ts");
 assert.match(form,/name="quick-rfq"/);assert.match(form,/data-netlify="true"/);assert.match(form,/name="form-name" value="quick-rfq"/);
 for(const name of ["partNumber","quantity","condition","email","aog","callbackNumber","aircraftLocation","requiredBy","aircraftTypeTail"])assert.match(form,new RegExp(`name="${name}"`));
 for(const name of ["partNumber","quantity","condition","email","aog","callbackNumber","aircraftLocation","requiredBy","aircraftTypeTail","sourcePage","aircraftBrand","partCategory"])assert.match(staticForm,new RegExp(`name="${name}"`));
 assert.match(staticForm,/name="quick-rfq"/);assert.match(staticForm,/data-netlify="true"/);
 assert.match(form,/fetch\("\/netlify-form\.html"/);assert.match(staticForm,/action="\/netlify-form\.html"/);
 assert.doesNotMatch(analytics,/partNumber|email|callbackNumber|aircraftLocation|requiredBy|aircraftTypeTail/);
});

test("dead AOG photography asset and references are removed",()=>{
 assert.equal(fs.existsSync(path.join(root,"public","aog-logistics.webp")),false);
 assert.doesNotMatch(read("app","globals.css")+read("components","AogContactStrip.tsx"),/aog-logistics\.webp|aog-photo/);
});
