import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {sql,withSession} from '@/data/db';
import {ensureFixtures,T,session} from './fixtures';
import {applyCreateDraft,applyIssue,applyCreditNote,applyPayment} from '@/data/invoice-apply';
import {amlRule} from '@/data/rules';
vi.mock('../../apps/crm/node_modules/next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/auth/session',()=>({requireSession:async()=> (await import('./fixtures')).session}));
import {createDraftInvoice} from '@/data/invoice-actions';
import {invoiceDraftReview} from '@/data/deal-invoice';
const customer=randomUUID(),cars:string[]=[];
let invoice:string,dealId:string;
async function fresh(create=true){const car=randomUUID(),deal=randomUUID();cars.push(car);
 await sql`INSERT INTO vehicles(id,tenant_id,site_id,registration,stock_number,stock_sequence,make,model,state,vat_scheme,retail_price_pence) VALUES(${car}::uuid,${T.tenant}::uuid,${T.site}::uuid,${car.slice(0,8)},${car},${parseInt(car.slice(0,7),16)},'Ford','Safeguard','ready','qualifying',100000)`;
 await sql`INSERT INTO deals(id,tenant_id,site_id,contact_id,vehicle_id,state,vehicle_price_pence,created_by) VALUES(${deal}::uuid,${T.tenant}::uuid,${T.site}::uuid,${customer}::uuid,${car}::uuid,'agreed',100000,${T.user}::uuid)`;
 if(!create)return {invoice:'',deal};
 const r=await withSession(session,tx=>applyCreateDraft(tx,session,{dealId:deal,vehicleId:car,contactId:customer,buyerName:'Safeguard Customer',buyerAddress:'1 Test Street',vatScheme:'qualifying',lines:[{description:'Test car',unitPricePence:'100000',unitPriceIncludesVat:true}]}));expect(r.ok,r.error).toBe(true);return {invoice:r.invoiceId!,deal};
}
const payment=(id:string,amount:string,direction='in',method='card')=>({invoiceId:id,amountPence:amount,direction,method,reason:'Local test refund or receipt',reference:'local-test',overrideReason:'',overrideAuthorisedBy:''});
beforeAll(async()=>{await ensureFixtures();await sql`INSERT INTO contacts(id,tenant_id,first_name,last_name,address_line1,postcode) VALUES(${customer}::uuid,${T.tenant}::uuid,'Safeguard','Customer','1 Test Street','MK1 1AA')`;const f=await fresh();invoice=f.invoice;dealId=f.deal;});
afterAll(async()=>{await sql`UPDATE vehicles SET state='archived' WHERE id=ANY(${cars}::uuid[])`;await sql.end();});
it('enforces permission at each data mutation and safely refuses bad IDs/directions',async()=>{
 const denied={...session,permissions:[]};
 expect((await withSession(denied,tx=>applyIssue(tx,denied,invoice))).ok).toBe(false);
 expect((await withSession(denied,tx=>applyCreditNote(tx,denied,invoice,'test reason'))).ok).toBe(false);
 expect((await withSession(denied,tx=>applyPayment(tx,denied,payment(invoice,'100')))).ok).toBe(false);
 expect((await withSession(session,tx=>applyIssue(tx,session,'invalid'))).ok).toBe(false);
 expect((await withSession(session,tx=>applyPayment(tx,session,payment(invoice,'100','bogus')))).ok).toBe(false);
 const foreign={...session,tenantId:randomUUID()};expect((await withSession(foreign,tx=>applyIssue(tx,foreign,invoice))).ok).toBe(false);
 const branch={...session,scope:'my_sites' as const,siteIds:[randomUUID()]};expect((await withSession(branch,tx=>applyIssue(tx,branch,invoice))).ok).toBe(false);
});
it('refuses a stale total before allocating any invoice number',async()=>{
 await sql`UPDATE deals SET vehicle_price_pence=110000 WHERE id=${dealId}::uuid`;
 const r=await withSession(session,tx=>applyIssue(tx,session,invoice));expect(r.ok).toBe(false);expect(r.error).toContain('total');
 const [row]=await sql`SELECT status,number FROM invoices WHERE id=${invoice}::uuid`;expect(row?.['status']).toBe('draft');expect(row?.['number']).toBeNull();
 await sql`UPDATE deals SET vehicle_price_pence=100000 WHERE id=${dealId}::uuid`;
});
it('serializes duplicate issue and duplicate credit without consuming extra numbers',async()=>{
 const issued=await Promise.all([1,2].map(()=>withSession(session,tx=>applyIssue(tx,session,invoice))));expect(issued.filter(r=>r.ok)).toHaveLength(1);
 const [before]=await sql`SELECT last_number FROM invoice_sequences WHERE tenant_id=${T.tenant}::uuid AND series='sale'`;
 const credited=await Promise.all([1,2].map(()=>withSession(session,tx=>applyCreditNote(tx,session,invoice,'Local duplicate credit test'))));expect(credited.filter(r=>r.ok)).toHaveLength(1);
 const [after]=await sql`SELECT last_number FROM invoice_sequences WHERE tenant_id=${T.tenant}::uuid AND series='sale'`;expect(BigInt(after!['last_number'] as string)-BigInt(before!['last_number'] as string)).toBe(1n);
 expect(await sql`SELECT id FROM audit_events WHERE resource_id=${invoice}::uuid AND action='issued'`).toHaveLength(1);
 expect((await withSession(session,tx=>applyPayment(tx,session,payment(invoice,'100')))).ok).toBe(false);
});
it('serializes refunds so two requests cannot refund the same receipt twice',async()=>{
 const f=await fresh();expect((await withSession(session,tx=>applyIssue(tx,session,f.invoice))).ok).toBe(true);
 expect((await withSession(session,tx=>applyPayment(tx,session,payment(f.invoice,'10000')))).ok).toBe(true);
 const refunds=await Promise.all([1,2].map(()=>withSession(session,tx=>applyPayment(tx,session,payment(f.invoice,'7000','out')))));expect(refunds.filter(r=>r.ok)).toHaveLength(1);
 const [row]=await sql`SELECT sum(CASE WHEN direction='in' THEN amount_pence ELSE -amount_pence END)::text AS balance FROM payments WHERE invoice_id=${f.invoice}::uuid`;expect(row?.['balance']).toBe('3000');
});
it('serializes cash checks across different invoices for the same customer',async()=>{
 const a=await fresh(),b=await fresh();for(const f of [a,b])expect((await withSession(session,tx=>applyIssue(tx,session,f.invoice))).ok).toBe(true);
 const rule=await amlRule(new Date()),amount=(rule.amountPence/2n+1n).toString();
 const results=await Promise.all([a,b].map(f=>withSession(session,tx=>applyPayment(tx,session,payment(f.invoice,amount,'in','cash')))));
 expect(results.filter(r=>r.ok)).toHaveLength(1);expect(results.filter(r=>r.aml?.outcome==='blocked')).toHaveLength(1);
});

it('routes the legacy action through the reviewed source and ignores forged pricing fields',async()=>{
 const f=await fresh(false),form=new FormData();form.set('dealId',f.deal);form.set('vehiclePrice','0.01');form.set('buyerName','Forged buyer');form.set('vatScheme','margin');form.set('extraDescription','Forged extra');form.set('extraPrice','-999.99');
 expect((await createDraftInvoice(null,form)).ok).toBe(false);
 const review=await invoiceDraftReview(session,f.deal);expect(review?.problem).toBeNull();form.set('revision',review!.revision);
 const result=await createDraftInvoice(null,form);expect(result.ok,result.error).toBe(true);
 const [row]=await sql`SELECT gross_total_pence,buyer_name,vat_scheme FROM invoices WHERE id=${result.invoiceId!}::uuid`;
 expect(String(row?.['gross_total_pence'])).toBe('100000');expect(row?.['buyer_name']).toBe('Safeguard Customer');expect(row?.['vat_scheme']).toBe('qualifying');
 expect(await sql`SELECT id FROM invoice_lines WHERE invoice_id=${result.invoiceId!}::uuid`).toHaveLength(1);
});
