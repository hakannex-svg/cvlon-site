export const partCategories = {
  "avionics-instruments": {
    name:"Avionics & Instruments", category:"Avionics & Instruments",
    intro:"Source flight-deck, navigation, communication and instrument units with configuration context, stated condition and available records identified for review.",
    examples:["Flight displays and display units","NAV/COM and audio systems","Transponders and TCAS components","FMS, ADC and AHRS units","Weather-radar components","Sensors, indicators and instruments"],
    docs:["Provide the exact part and dash number","State known modification status","Provide software or configuration information where applicable","Identify test status and available source records","State required release or supporting documentation","Include exchange or core information where applicable"],
    buyerNote:"Civilon does not independently validate software or aircraft configuration. Available status and source records are reviewed where applicable so the quoted option can be compared with the buyer’s requirement."
  },
  "wheels-brakes-landing-gear": {
    name:"Wheels, Brakes & Landing Gear", category:"Wheels, Brakes & Landing Gear",
    intro:"Coordinate sourcing for wheel, brake and landing-gear components with aircraft position, condition, life data and documentation requirements stated clearly.",
    examples:["Main and nose wheel assemblies","Brake assemblies, discs and linings","Anti-skid and steering components","Landing-gear actuators and struts","Uplock and downlock assemblies","Selector, shuttle and control valves"],
    docs:["Confirm model, serial and installation position","Provide component serial information where available","Identify time, cycle or life data where applicable","State acceptable condition and release-document requirements","Clarify core ownership and exchange terms","Include required-by timing for an AOG request"],
    buyerNote:"Position, effectivity and life information can change which option is usable. Core and exchange obligations, warranty terms and available records are stated with the quotation."
  },
  "engine-airframe-accessories": {
    name:"Engine & Airframe Accessories", category:"Engine & Airframe Accessories",
    intro:"Find engine accessories, system components and airframe equipment with application, dash number, condition and documentation requirements defined.",
    examples:["Starter generators, GCUs and voltage regulators","Fuel pumps, fuel controls and ignition components","Bleed-air, ECS and hydraulic valves","Hydraulic pumps and actuators","Filters, windows and transparencies","Lighting and approved airframe hardware"],
    docs:["Provide engine or aircraft application","Confirm exact part and dash number","Include available shop findings or removal information","State acceptable condition and documentation","Clarify exchange and core requirements","Compare repair, exchange or replacement paths where appropriate"],
    buyerNote:"Accessory requirements can be application- and dash-number-specific. Civilon coordinates available repair, exchange and replacement options; availability remains subject to confirmation."
  },
} as const;

export const aircraft = {
  beechcraft:{
    name:"Beechcraft", intro:"Parts sourcing for Beechcraft turboprop, jet and piston families, with model, serial, installation position and effectivity context kept with the request.",
    models:["King Air 90 / 100","King Air 200 / 250","King Air 300 / 350","Premier I / IA","Beechjet 400 / 400A","Baron and Bonanza"],
    groups:[{title:"King Air",body:"King Air requirements often depend on model, serial range, engine application and installation position."},{title:"Premier and Beechjet",body:"Jet-platform requests benefit from exact dash number, modification status and avionics configuration where applicable."},{title:"Baron and Bonanza",body:"Piston-aircraft requirements are reviewed by exact model, application, condition and document need."}],
    notes:"Include the model, aircraft serial context, installation position and any known effectivity information. Relevant paths include avionics, wheels and brakes, engine accessories, repair coordination and AOG support."
  },
  "cessna-citation":{
    name:"Cessna Citation", intro:"Configuration-aware parts sourcing across Citation light, midsize and larger-cabin families.",
    models:["Citation CJ / CJ1 / CJ2","CJ3 / CJ4","Citation Mustang","Citation 500 / 550 / 560","Excel / XLS / XLS+","Sovereign","Latitude","Longitude"],
    groups:[{title:"CJ and Mustang",body:"Light-jet requirements may depend on serial range, dash number, modification status and avionics configuration."},{title:"Legacy and midsize Citation",body:"500/550/560, Excel/XLS and Sovereign requests should include exact variant and effectivity context."},{title:"Latitude and Longitude",body:"Current-platform requests are reviewed against the stated aircraft, installation and available configuration records."}],
    notes:"Provide exact model, serial context, part and dash number, modification status where known, stated condition and required records. Civilon reviews available source information rather than independently validating aircraft configuration."
  },
  bombardier:{
    name:"Bombardier", intro:"Component sourcing for Learjet, Challenger and Global fleets, including mature platforms and current long-range aircraft.",
    models:["Learjet 40 / 45","Learjet 60 / 70 / 75","Challenger 300 / 350","Challenger 601 / 604 / 605 / 650","Global Express / 5000 / 6000","Global 5500 / 6500 / 7500"],
    groups:[{title:"Learjet",body:"Mature-platform sourcing may require careful review of alternates, repairability, core terms and available records."},{title:"Challenger",body:"Exact model, serial, installation and effectivity help distinguish usable options across the family."},{title:"Global",body:"Configuration, documentation and repair-versus-exchange requirements should be stated at RFQ."}],
    notes:"Include aircraft family, exact model, serial/effectivity context, acceptable condition and required documentation."
  },
  "dassault-falcon":{
    name:"Dassault Falcon", intro:"Targeted sourcing for Falcon aircraft where exact variant, aircraft serial, installation and technical-document alignment are central to a usable option.",
    models:["Falcon 50 family","Falcon 900 family","Falcon 2000 series","Falcon 7X","Falcon 8X"],
    groups:[{title:"Exact family and variant",body:"State the complete Falcon model or variant rather than relying on a family-level description."},{title:"Aircraft and installation context",body:"Aircraft serial and installation position help establish applicable effectivity."},{title:"Modification and documentation",body:"Provide known modification or service-bulletin status and the release or supporting records required."}],
    notes:"Falcon requests benefit from aircraft serial, installation location and known modification or service-bulletin context. Available source records are reviewed where applicable."
  },
  embraer:{
    name:"Embraer", intro:"Parts sourcing across Embraer executive-aircraft families, with exact model, serial, condition and documentation requirements captured at RFQ.",
    models:["Phenom 100 family","Phenom 300 family","Legacy 450 / 500","Legacy 600 / 650","Praetor 500 / 600"],
    groups:[{title:"Phenom",body:"Light-jet requirements should identify the exact model, serial context, part application and acceptable condition."},{title:"Legacy",body:"Legacy requests can involve mature-platform availability, repair, exchange and documentation comparisons."},{title:"Praetor",body:"Praetor requirements are reviewed with exact model, effectivity and available configuration records where applicable."}],
    notes:"Specify the exact model, aircraft serial, installation context, acceptable condition and document requirement so repair, exchange and replacement options can be compared."
  },
} as const;
