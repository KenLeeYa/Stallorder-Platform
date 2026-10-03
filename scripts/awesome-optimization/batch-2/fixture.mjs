import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { assertResponsiveQaTarget } from '../../responsive-qa-target.mjs';
import {projectLegacyApplications} from '../../../docs/awesome-optimization/qa/application-schema-overlay.mjs';

loadEnvFile('.env.local');
assertResponsiveQaTarget(process.env);
const project = 'stallorder-responsive-20260930';
const containers = JSON.parse(execFileSync('docker', ['inspect', `supabase_db_${project}`], { encoding: 'utf8' }));
if (containers.length !== 1 || !containers[0].State.Running || containers[0].Config.Labels['com.supabase.cli.project'] !== project
  || containers[0].NetworkSettings.Ports['5432/tcp']?.[0]?.HostPort !== '56822') throw Error('AWESOME_FIXTURE_TARGET_INVALID');
// Target is positively identified before importing/constructing any database client.
const { PrismaClient } = await import('@prisma/client');
const database = new PrismaClient();
const output = '.superpowers/sdd/2026-10-01-awesome-optimization/batch-2';
mkdirSync(output, { recursive: true });
const id = (kind, n) => { const s = createHash('sha256').update(`awesome-b1/${kind}/${n}`).digest('hex'); return `${s.slice(0,8)}-${s.slice(8,12)}-4${s.slice(13,16)}-8${s.slice(17,20)}-${s.slice(20,32)}`; };
const hash = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const timestamp = new Date('2026-09-30T04:00:00.000Z');
const organizations = [id('org',0), id('org',1)];
const stalls = [id('stall',0), id('stall',1), id('stall',2)];
const names = ['珍珠奶茶','珍珠鮮奶茶','紅茶','奶茶','臺灣茶','台灣茶','literal %_\\/ 茶','超長繁體中文商品名稱用於手機與鍵盤可讀性驗證🍵'];
try {
  if (process.argv.includes('--create')) {
    if (await database.organization.count({ where: { id: { in: organizations } } })) throw Error('AWESOME_FIXTURE_ALREADY_EXISTS_USE_FREEZE');
    const profiles = await database.profile.findMany({ where: { email: { in: ['owner@stallorder.test','finance@stallorder.test','staff@stallorder.test','kitchen@stallorder.test','platform.admin@stallorder.test'] } }, select: { id: true, email: true, platformRole: true } });
    const owner = profiles.find(p => p.email === 'owner@stallorder.test');
    const admin = profiles.find(p => p.email === 'platform.admin@stallorder.test');
    if (!owner || admin?.platformRole !== 'PLATFORM_ADMIN') throw Error('AWESOME_FIXTURE_ROLES_MISSING');
    const plan = await database.planVersion.findFirstOrThrow({ where: { pricingMode:'FIXED', maxStalls:{gte:3} }, orderBy:{createdAt:'asc'} });
    await database.$transaction(async tx => {
      await tx.organization.createMany({ data: organizations.map((org,n) => ({ id: org, name: `awesome-b1 組織 ${n}`, businessName: `awesome-b1 合成商家 ${n}`, slug: `awesome-b1-org-${n}`, email: `awesome-b1-org-${n}@stallorder.test`, phone: '0900000000', status: 'ACTIVE', operatingMode: n === 0 ? 'MULTI_STALL' : 'SINGLE_STALL', createdAt: timestamp })) });
      await tx.subscription.createMany({ data:organizations.map(org=>({organizationId:org,planId:plan.planId,planVersionId:plan.id,status:'ACTIVE',billingPeriodStart:new Date('2026-09-01'),billingPeriodEnd:new Date('2026-11-01')})) });
      await tx.stall.createMany({ data: stalls.map((stall,n) => ({ id: stall, organizationId: organizations[n === 2 ? 1 : 0], name: `awesome-b1 攤位 ${n}`, slug: `awesome-b1-stall-${n}`, code: `AWB1${n}`, address: '合成資料地址', location: '合成測試區', businessStatus: 'CLOSED', orderingEnabled: false, createdAt: timestamp })) });
      await tx.stallOrderingSettings.createMany({ data: stalls.map((stall,n) => ({ organizationId: organizations[n === 2 ? 1 : 0], stallId: stall })) });
      await tx.organizationMembership.createMany({ data: organizations.flatMap(org => [{ organizationId: org, profileId: owner.id, role: 'ORGANIZATION_OWNER', allStalls: true }, ...profiles.filter(p => p.email === 'finance@stallorder.test').map(p => ({ organizationId: org, profileId: p.id, role: 'FINANCE_VIEWER', allStalls: true }))]) });
      await tx.stallMembership.createMany({ data: profiles.filter(p => p.email === 'staff@stallorder.test' || p.email === 'kitchen@stallorder.test').map(p => ({ organizationId: organizations[0], stallId: stalls[0], profileId: p.id, role: p.email === 'staff@stallorder.test' ? 'STAFF' : 'KITCHEN' })) });
      await tx.productCategory.createMany({ data: organizations.map((org,n) => ({ id: id('category',n), organizationId: org, name: `awesome-b1 茶飲 ${n}` })) });
      await tx.productGroup.createMany({ data: organizations.map((org,n) => ({ id: id('group',n), organizationId: org, categoryId: id('category',n), name: 'awesome-b1 茶飲群組' })) });
      await tx.product.createMany({ data: Array.from({ length:1000 }, (_,n) => { const org = n < 900 ? 0 : 1; return { id: id('product',n), organizationId: organizations[org], categoryId: id('category',org), groupId: n % 2 ? id('group',org) : null, name: n < 8 ? names[n] : n === 900 ? 'awesome-b1 FOREIGN ONLY' : `awesome-b1 商品 ${String(n).padStart(4,'0')}`, description: 'awesome-b1 合成說明；不得作真實下單', defaultPrice: 50, sortOrder: n < 8 ? 0 : n, createdAt:timestamp }; }) });
      await tx.productTranslation.createMany({ data: [0,900].map(n => ({ organizationId: organizations[n === 0 ? 0 : 1], productId:id('product',n), locale:'en', name:'Pearl Milk Tea', description:'Synthetic fixture' })) });
      await tx.stallProduct.createMany({ data: Array.from({ length:1000 }, (_,n) => ({ organizationId: organizations[n < 900 ? 0 : 1], stallId:stalls[n < 900 ? n % 2 : 2], productId:id('product',n), isEnabled:true })) });
      await tx.order.createMany({ data: Array.from({ length:500 }, (_,n) => ({ id:id('order',n), organizationId:organizations[n < 450 ? 0 : 1], stallId:stalls[n < 450 ? n % 2 : 2], orderNo:`AWB1-${String(n).padStart(4,'0')}`, trackingTokenHash:hash(`awesome-b1-tracking-${n}`), idempotencyKey:id('intent',n), customerName:'awesome-b1 合成顧客', customerPhone:'0900000000', subtotal:50, total:50, deviceHash:'awesome-b1', confirmationExpiresAt:new Date('2026-10-30T04:00:00Z'), status:'COMPLETED', createdAt:timestamp, completedAt:timestamp, isTest:false })) });
      await tx.profile.createMany({ data: Array.from({ length:201 },(_,n) => ({ id:id('applicant',n), email:`awesome-b1-applicant-${n}@stallorder.test`, displayName:`awesome-b1 合成申請人 ${n}` })) });
      await tx.merchantApplication.createMany({ data: Array.from({ length:201 },(_,n) => ({ id:id('application',n), applicantProfileId:id('applicant',n), applicantEmail:`awesome-b1-applicant-${n}@stallorder.test`, applicantDisplayName:`awesome-b1 合成申請人 ${n}`, merchantName:`awesome-b1 商家 ${String(n).padStart(4,'0')}`, stallName:'awesome-b1 合成攤位', city:'臺北市', status:'PENDING_REVIEW', businessType:'NIGHT_MARKET_STALL', contactName:'合成聯絡人', phone:'0900000000', phoneHash:hash(`awesome-b1-phone-${n}`), businessPhone:'0900000000', preferredContactMethod:'PHONE', businessAddress:'合成地址', stallLocation:'合成測試區', requestedSlug:`awesome-b1-application-${n}`, termsAccepted:true, privacyAccepted:true, dataProcessingAccepted:true, informationConfirmed:true, consentedAt:timestamp, submittedAt:timestamp, createdAt:timestamp })) });
    }, { timeout:60000 });
  }
  const dataset = {};
  for (const [name,where] of Object.entries({ organization:{id:{in:organizations}}, stall:{id:{in:stalls}}, product:{organizationId:{in:organizations}}, productTranslation:{organizationId:{in:organizations}}, stallProduct:{organizationId:{in:organizations}}, order:{organizationId:{in:organizations}}, merchantApplication:{id:{in:Array.from({length:201},(_,n)=>id('application',n))}} })) {
    dataset[name] = await database[name].findMany({ where, orderBy:{id:'asc'} });
  }
  dataset.merchantApplication=projectLegacyApplications(dataset.merchantApplication);
  const counts = Object.fromEntries(Object.entries(dataset).map(([k,v])=>[k,v.length]));
  if (counts.organization!==2 || counts.stall!==3 || counts.product!==1000 || counts.order!==500 || counts.merchantApplication!==201) throw Error('AWESOME_FIXTURE_COUNTS_INVALID');
  const frozen = { marker:'awesome-b1', organizations, stalls, timestamp:timestamp.toISOString(), counts, digest:hash(dataset), recordIds:Object.fromEntries(Object.entries(dataset).map(([k,v])=>[k,v.map(r=>r.id)])) };
  const file=`${output}/fixture-freeze.json`;
  if (existsSync(file)) { if (JSON.parse(readFileSync(file)).digest !== frozen.digest) throw Error('AWESOME_FIXTURE_DRIFT'); }
  else writeFileSync(file,JSON.stringify(frozen,null,2)+'\n');
  console.log(JSON.stringify({marker:frozen.marker,counts,digest:frozen.digest,verifiedAt:new Date().toISOString()}));
} finally { await database.$disconnect(); }
