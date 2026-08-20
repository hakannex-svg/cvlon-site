import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root=path.resolve(import.meta.dirname,"..");
const publicDirs=["app","components","content","lib"];
const files=publicDirs.flatMap(dir=>fs.readdirSync(path.join(root,dir),{recursive:true,withFileTypes:true}).filter(x=>x.isFile()&&/\.(tsx?|mjs)$/.test(x.name)).map(x=>path.join(x.parentPath,x.name)));
const publicSource=files.map(file=>fs.readFileSync(file,"utf8")).join("\n");
const read=(...parts)=>fs.readFileSync(path.join(root,...parts),"utf8");
const hasUnsupportedCivilonCertificationClaim=(source)=>source
  .split(/[\n.!?;]+/)
  .filter(clause=>/\bCivilon\b/i.test(clause)&&/\bcertif(?:y|ies|ied|ication)\b/i.test(clause))
  .some(clause=>{
    const certificationIndex=clause.search(/\bcertif(?:y|ies|ied|ication)\b/i);
    const precedingContext=clause.slice(Math.max(0,certificationIndex-80),certificationIndex);
    return !/(?:\b(?:do|does|did|is|are|was|were|will|would|can|could|shall|should)\s+not\b|\bnever\b|\bneither\b|\bnothing\b|\bnot\b(?:(?!\bonly\b).){0,40}$)/i.test(precedingContext);
  });

test("public identity and contact details match the approved company information",()=>{
  assert.doesNotMatch(publicSource,/Civilon Air(?!craft)/i);
  assert.doesNotMatch(publicSource,/201[ .-]*903[ .-]*6461|12019036461/);
  assert.match(publicSource,/Civilon LLC/);
  assert.match(publicSource,/375 Sylvan Ave, Suite 23/);
  assert.match(publicSource,/\+1 909 344 4444/);
  assert.match(publicSource,/tel:\$\{siteConfig\.(?:officeTel|aogTel)\}/);
  assert.match(publicSource,/Monday–Friday, 8:00 AM–5:00 PM Eastern Time/);
  assert.match(publicSource,/Closed weekends and U\.S\. holidays/);
});

test("approved AOG response language and monitored availability are present",()=>{
  // The AOG page states the one approved proof line and no response-time
  // promise: a time an unattended sourcing desk cannot hold is a claim, not a
  // service level.
  const aog=read("app","aog-services","page.tsx");
  assert.match(aog,/The AOG line is answered by a live person, 24\/7\/365/);
  assert.doesNotMatch(aog,/immediate initial response|within one hour|response time/i);
  assert.doesNotMatch(aog,/within \d+ (?:minutes?|hours?|business days?|days?)/i);
  assert.match(read("app","contact-us","page.tsx"),/monitored by a live person, 24\/7\/365/);
  assert.match(publicSource,/live person 24\/7\/365/);
  assert.doesNotMatch(publicSource,/<\s*1\s*hr|guaranteed one-hour|immediate quote/i);
});

test("unsupported certification and blanket trace claims are absent",()=>{
  assert.doesNotMatch(publicSource,/AS9120|ISO 9001|certified parts|Civilon[- ]certified/i);
  assert.equal(hasUnsupportedCivilonCertificationClaim("Civilon certifies parts."),true);
  assert.equal(hasUnsupportedCivilonCertificationClaim("Civilon's review certifies a part."),true);
  assert.equal(hasUnsupportedCivilonCertificationClaim("Civilon does not certify parts."),false);
  assert.equal(hasUnsupportedCivilonCertificationClaim("Neither the upload nor Civilon's review certifies anything."),false);
  assert.equal(hasUnsupportedCivilonCertificationClaim(publicSource),false);
  assert.doesNotMatch(publicSource,/100% trace|always full trace|full trace on every part|fully traceable/i);
  assert.match(publicSource,/trace-to-source/i);
  assert.match(publicSource,/Documentation varies by part(?:,)?(?: condition and| and)? source|Documentation varies by part and source/i);
});

test("approved commercial qualifications are explicit",()=>{
  assert.match(publicSource,/Warranty terms vary by part condition and source and are stated with each quotation\./);
  assert.match(publicSource,/All availability is subject to confirmation\./);
  for(const condition of ["NE — New","NS — New Surplus","OH — Overhauled","SV — Serviceable","AR — As Removed"])assert.match(publicSource,new RegExp(condition));
});

test("Airbus and Boeing remain additional platforms by request only",()=>{
  const aircraftHub=read("app","aircraft","page.tsx");
  assert.match(aircraftHub,/Additional platforms by request/);
  assert.match(aircraftHub,/Airbus and Boeing requirements can also be reviewed and sourced by exact part number/);
  assert.ok(!fs.existsSync(path.join(root,"app","aircraft","airbus")));
  assert.ok(!fs.existsSync(path.join(root,"app","aircraft","boeing")));
});

test("page metadata directions are unique and RFQ contexts remain correct",()=>{
  const pageFiles=files.filter(file=>file.endsWith(`${path.sep}page.tsx`));
  const metadata=[];
  for(const file of pageFiles){for(const match of fs.readFileSync(file,"utf8").matchAll(/pageMetadata\("([^"]+)","([^"]+)"/g))metadata.push([match[1],match[2],file]);}
  assert.equal(new Set(metadata.map(x=>x[0])).size,metadata.length);
  assert.equal(new Set(metadata.map(x=>x[1])).size,metadata.length);
  assert.match(read("app","aog-services","page.tsx"),/defaultAog/);
  assert.match(read("app","aircraft","[manufacturer]","page.tsx"),/aircraftBrand=\{d\.name\}/);
  assert.match(read("app","parts","[category]","page.tsx"),/partCategory=\{d\.category\}/);
});

test("structured data contains only approved organization, contact and breadcrumb types",()=>{
  const schemaSource=read("app","layout.tsx")+read("components","Interior.tsx");
  for(const allowed of ["Organization","LocalBusiness","ContactPoint","PostalAddress","OpeningHoursSpecification","BreadcrumbList","ListItem"])assert.match(schemaSource,new RegExp(allowed));
  assert.doesNotMatch(schemaSource,/"@type"\s*:\s*"(?:Product|Offer|AggregateRating|Review)"|certificationType/i);
});
