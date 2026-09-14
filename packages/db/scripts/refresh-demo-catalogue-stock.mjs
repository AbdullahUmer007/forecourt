/** Explicitly scoped demo refresh. Dry-run unless --apply; never deletes evidence. */
import postgres from 'postgres';
import {writeFileSync} from 'node:fs';
import {requireDatabaseUrl} from '../../../scripts/load-env.mjs';
const tenant='11111111-1111-4111-8111-111111111111',site='11111111-1111-4111-8111-111111111112';
const url=requireDatabaseUrl(),host=new URL(url).hostname;
const target=process.argv.includes('--railway')?'railway':'local';
if(target==='local'&&!['localhost','127.0.0.1'].includes(host))throw new Error('Local refresh requires a local database.');
if(target==='railway'&&!/railway|rlwy/.test(host))throw new Error('Railway refresh requires an explicit Railway database host.');
const sql=postgres(url,{max:1,ssl:target==='railway'?{rejectUnauthorized:false}:false,onnotice:()=>{}});
// Source IDs identify exact derivatives in the provided make/model/variant catalogue.
const specs=[
 [9684,2020,1299500,38500,'petrol','manual','hatchback','Blue'],
 [9703,2017,899500,61200,'petrol','manual','hatchback','Silver'],
 [9533,2019,1099500,34200,'petrol','manual','hatchback','Red'],
 [932,2016,1149500,56300,'petrol','manual','hatchback','Grey'],
 [931,2015,999500,68400,'petrol','automatic','hatchback','White'],
 [14363,2019,1399500,45800,'petrol','manual','suv','Black'],
 [27036,2021,1799500,28100,'hybrid','automatic','hatchback','Silver'],
 [27024,2020,1699500,41700,'hybrid','automatic','estate','Blue'],
];
try{
 const [dealer]=await sql`SELECT name FROM tenants WHERE id=${tenant}::uuid`;
 if(dealer?.name!=='Kennington Car Sales')throw new Error('Expected named demo tenant not found.');
 const catalogue=await sql`SELECT v.id,v.source_id,v.name,v.label,v.hp,m.id AS model_id,m.name AS model,mk.id AS make_id,mk.name AS make FROM vehicle_variants v JOIN vehicle_models m ON m.id=v.model_id JOIN vehicle_makes mk ON mk.id=m.make_id WHERE v.source_id=ANY(${specs.map(s=>s[0])}::int[])`;
 if(catalogue.length!==specs.length)throw new Error('Catalogue incomplete or ambiguous; no stock changed.');
 const old=await sql`SELECT id,state,stock_number,make,model,derivative FROM vehicles WHERE tenant_id=${tenant}::uuid AND deleted_at IS NULL AND state NOT IN ('archived','sold','delivered') AND stock_number NOT LIKE 'CAT-DEMO-%' ORDER BY stock_sequence`;
 console.log(JSON.stringify({target,tenant:dealer.name,archiveCount:old.length,stock:specs.map(s=>({sourceId:s[0],variant:catalogue.find(c=>c.source_id===s[0])?.label,year:s[1]}))},null,2));
 if(process.argv.includes('--apply')){
  const snapshot=process.argv.find(a=>a.startsWith('--snapshot='))?.slice(11);
  if(!snapshot)throw new Error('Provide --snapshot=<new backup file> before applying.');
  writeFileSync(snapshot,JSON.stringify({target,tenant,at:new Date().toISOString(),vehicles:old},null,2),{flag:'wx'});
  await sql.begin(async tx=>{
   await tx`SELECT id FROM tenants WHERE id=${tenant}::uuid FOR UPDATE`;
   for(const row of old){
    const changed=await tx`UPDATE vehicles SET state='archived',state_changed_at=now(),updated_at=now() WHERE tenant_id=${tenant}::uuid AND id=${row.id}::uuid AND state=${row.state}::vehicle_state RETURNING id`;
    if(changed.length!==1)throw new Error('Demo stock changed since review; transaction rolled back.');
    await tx`INSERT INTO audit_events(tenant_id,site_id,actor_type,resource_type,resource_id,action,diff) VALUES(${tenant}::uuid,${site}::uuid,'system','vehicle',${row.id}::uuid,'demo_stock_archived',${sql.json({before:row,after:{state:'archived'},reason:'User-authorized catalogue demo refresh'})})`;
   }
   const [max]=await tx`SELECT coalesce(max(stock_sequence),0)::int AS n FROM vehicles WHERE tenant_id=${tenant}::uuid`;
   let sequence=max.n;
   for(const [index,s] of specs.entries()){
    const c=catalogue.find(c=>c.source_id===s[0]),stock=`CAT-DEMO-${s[0]}`;
    const existing=await tx`SELECT id FROM vehicles WHERE tenant_id=${tenant}::uuid AND stock_number=${stock}`;if(existing.length)continue;
    const [v]=await tx`INSERT INTO vehicles(tenant_id,site_id,stock_number,stock_sequence,registration,make_id,model_id,variant_id,make,model,derivative,model_year,retail_price_pence,mileage,fuel_type,transmission,body_style,colour,doors,seats,power_bhp,state,live_at,vat_scheme,advert_description) VALUES(${tenant}::uuid,${site}::uuid,${stock},${++sequence},${`DEMO${String(index+1).padStart(3,'0')}`},${c.make_id}::uuid,${c.model_id}::uuid,${c.id}::uuid,${c.make},${c.model},${c.label},${s[1]},${s[2]},${s[3]},${s[4]},${s[5]},${s[6]},${s[7]},5,5,${c.hp},'live',now(),'qualifying','DEMO STOCK — catalogue example for website and filter testing. Not a vehicle offered for sale. Photographs, provenance and availability require verification before real publication.') RETURNING id`;
    await tx`INSERT INTO audit_events(tenant_id,site_id,actor_type,resource_type,resource_id,action,diff) VALUES(${tenant}::uuid,${site}::uuid,'system','vehicle',${v.id}::uuid,'demo_catalogue_stock_created',${sql.json({sourceId:c.source_id,makeId:c.make_id,modelId:c.model_id,variantId:c.id,stockNumber:stock})})`;
   }
  });
  console.log('Demo refresh committed; previous records and evidence retained.');
 }
 const [check]=await sql`SELECT count(*)::int AS cars,count(*) FILTER(WHERE mk.id=v.make_id AND m.make_id=v.make_id AND cv.model_id=v.model_id AND v.make=mk.name AND v.model=m.name AND v.derivative=cv.label)::int AS catalogue_matches FROM vehicles v JOIN vehicle_makes mk ON mk.id=v.make_id JOIN vehicle_models m ON m.id=v.model_id JOIN vehicle_variants cv ON cv.id=v.variant_id WHERE v.tenant_id=${tenant}::uuid AND v.stock_number LIKE 'CAT-DEMO-%' AND v.deleted_at IS NULL`;
 console.log(JSON.stringify({verification:check}));
}finally{await sql.end();}
