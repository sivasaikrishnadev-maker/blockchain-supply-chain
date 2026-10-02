import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { QRCodeCanvas } from 'qrcode.react';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Activity, ArrowLeft, ArrowRight, ArrowUpRight, Box, Check,
  CheckCircle2, ChevronRight, CircleAlert, Clipboard, Clock3, Factory, Fingerprint,
  Layers3, Link2, LoaderCircle, LockKeyhole, LogOut, Menu, PackageCheck,
  PackagePlus, QrCode, ScanLine, Search, ShieldCheck, Store, Truck, X,
} from 'lucide-react';
import {
  getGetCurrentUserQueryKey, getGetDashboardStatsQueryKey, getGetProductEventsQueryKey,
  getGetProductQueryKey, getGetProductsQueryKey, getVerifyProductQueryKey,
  setAuthTokenGetter, useCreateProduct, useDistributorReceive, useDistributorTransfer,
  useGetCurrentUser, useGetDashboardStats, useGetProduct, useGetProductEvents,
  useGetProducts, useLogin, useMarkProductAvailable, useRetailerReceive, useVerifyProduct,
} from '@workspace/api-client-react';
import type { Product, ProductInput, User } from '@workspace/api-client-react';
import { Link, Route, Switch, useLocation, useRoute } from 'wouter';
import NotFound from '@/pages/not-found';
import { getVerificationUrl } from '@/lib/public-url';

const queryClient = new QueryClient();
const TOKEN_KEY = 'chain-ledger-token';
const USER_KEY = 'chain-ledger-user';
setAuthTokenGetter(() => localStorage.getItem(TOKEN_KEY));

const STATUS = ['Created', 'Received by Distributor', 'In Transit to Retailer', 'Received by Retailer', 'Available for Sale'];
const statusIcon = (status: string) => STATUS.indexOf(status) > 2 ? PackageCheck : status === STATUS[2] ? Truck : Box;
const shortHash = (hash?: string) => hash ? `${hash.slice(0, 11)}…${hash.slice(-7)}` : 'Not recorded';
const dateLabel = (date?: string) => date ? new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const roleTitle = (role?: string) => role ? role[0].toUpperCase() + role.slice(1) : 'Member';

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><Switch>
    <Route path="/" component={Landing} />
    <Route path="/login" component={LoginPage} />
    <Route path="/track" component={TrackPage} />
    <Route path="/verify/:productId" component={VerifyPage} />
    <Route path="/dashboard" component={DashboardPage} />
    <Route path="/products" component={ProductsPage} />
    <Route path="/products/new" component={NewProductPage} />
    <Route path="/products/:productId" component={ProductPage} />
    <Route component={NotFound} />
  </Switch><Toaster /></TooltipProvider></QueryClientProvider>;
}

function Brand({ inverse = false }: { inverse?: boolean }) {
  return <Link href="/" className={`brand flex items-center gap-3 ${inverse ? 'text-[#f3f0e8]' : 'text-[#1c3835]'}`} data-testid="link-home-brand">
    <span className="flex h-10 w-10 items-center justify-center bg-[#d9ad62] text-[#1c3835]"><Layers3 size={21} strokeWidth={2.3} /></span>
    <span className="leading-none"><strong className="font-display text-[15px] tracking-[-.04em]">CHAIN / LEDGER</strong><small className="mt-1.5 block font-mono text-[9px] tracking-[.16em] opacity-60">PRODUCT PROVENANCE</small></span>
  </Link>;
}

function PublicHeader() {
  return <header className="relative z-10 flex items-center justify-between border-b border-[#d9d2c5] px-5 py-4 md:px-12">
    <Brand /><nav className="flex items-center gap-5 text-sm font-semibold md:gap-9">
      <Link href="/track" className="hidden text-[#536662] hover:text-[#1c3835] sm:block" data-testid="link-track">Track a product</Link>
      <Link href="/login" className="flex items-center gap-2 bg-[#1c3835] px-4 py-2.5 text-[#f5f0e5] transition hover:bg-[#28524d]" data-testid="link-login">Sign in <ArrowRight size={15} /></Link>
    </nav>
  </header>;
}

function Landing() {
  return <main className="app-shell grain overflow-hidden">
    <PublicHeader />
    <section className="relative mx-auto grid max-w-[1440px] items-center gap-10 px-5 pb-16 pt-14 md:min-h-[650px] md:grid-cols-[1.08fr_.92fr] md:px-12 md:pb-20 md:pt-16">
      <div className="fade-up relative z-[1] max-w-[680px]">
        <div className="mb-7 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[.2em] text-[#53736d]"><span className="h-px w-9 bg-[#d19d4e]" />A shared record for every handoff</div>
        <h1 className="font-display text-[clamp(3.5rem,8.1vw,7.2rem)] font-semibold leading-[.91] tracking-[-.075em]">Goods move.<br /><span className="text-[#bb8c42]">Proof stays.</span></h1>
        <p className="mt-8 max-w-[480px] text-lg leading-8 text-[#5c6e68]">A clear chain of custody from the factory floor to the point of sale. Follow a product’s journey, handoff by handoff.</p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="/track" className="flex items-center gap-3 bg-[#1c3835] px-6 py-4 text-sm font-semibold text-[#f4f0e8] transition hover:bg-[#28524d]" data-testid="link-start-tracking">Track a product <ArrowRight size={17} /></Link>
          <Link href="/login" className="flex items-center gap-3 border border-[#bdb5a6] px-6 py-4 text-sm font-semibold hover:border-[#1c3835]" data-testid="link-team-login">For supply teams <ArrowUpRight size={16} /></Link>
        </div>
        <div className="mt-12 flex items-center gap-4 border-t border-[#d9d2c5] pt-5 text-xs text-[#62716d]"><ShieldCheck size={17} className="text-[#37746b]" /><span>Integrity checks compare the stored product record against its ledger entry.</span></div>
      </div>
      <div className="relative mx-auto w-full max-w-[540px] fade-up [animation-delay:120ms]">
        <div className="absolute -right-8 -top-7 z-10 hidden bg-[#d9ad62] px-5 py-4 md:block"><p className="font-mono text-[9px] uppercase tracking-[.18em] text-[#43534c]">Ledger event</p><p className="mt-1 font-display text-lg font-semibold">#004,821 <span className="text-sm font-normal">confirmed</span></p></div>
        <div className="relative aspect-[.94] overflow-hidden bg-[#d9d5c8]">
          <div className="absolute inset-0 bg-[linear-gradient(145deg,#879a8d_0%,#526f68_44%,#243f3c_100%)]" />
          <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(90deg, transparent 49.8%, #e0c481 50%, transparent 50.2%),linear-gradient(0deg, transparent 49.8%, #e0c481 50%, transparent 50.2%)', backgroundSize: '68px 68px' }} />
          <div className="absolute bottom-0 left-[10%] h-[68%] w-[52%] bg-[#d6c5a2] shadow-2xl">
            <div className="absolute inset-x-0 top-0 h-5 bg-[#c0ae8a]" />
            <div className="absolute left-[16%] top-[15%] h-[58%] w-[68%] border border-[#998b6c] bg-[#e1d6bf]">
              <div className="m-5 border-t border-[#b8a98a] pt-4"><span className="font-mono text-[9px] tracking-[.18em] text-[#7e775f]">LOT / 24—A</span><div className="mt-4 h-[2px] w-12 bg-[#59716a]" /><p className="mt-3 font-display text-xl font-semibold tracking-[-.05em] text-[#25443e]">FIELD<br />GOODS</p></div>
            </div>
            <div className="absolute -bottom-4 left-0 right-0 flex justify-around">{[0,1,2,3,4].map(n=><i key={n} className="h-4 w-[2px] bg-[#b4a687]" />)}</div>
          </div>
          <div className="absolute bottom-[8%] right-[8%] w-[35%] border border-white/20 bg-[#183531]/90 p-4 text-[#f3f0e8] backdrop-blur-sm">
            <div className="flex items-center justify-between"><span className="font-mono text-[9px] uppercase tracking-[.16em] text-[#cbb783]">Custody path</span><Activity size={14} /></div>
            <div className="mt-4 space-y-3">
              {[['01','Maker'],['02','Distributor'],['03','Retail']].map(([n,label],i)=><div key={n} className="flex items-center gap-3"><span className={`flex h-6 w-6 items-center justify-center border text-[9px] ${i===2?'border-[#d9ad62] text-[#d9ad62]':'border-white/30 text-white/70'}`}>{i<2?<Check size={11}/>:n}</span><span className="text-xs">{label}</span>{i<2&&<span className="ml-auto font-mono text-[8px] text-[#9db7a7]">LOGGED</span>}</div>)}
            </div>
          </div>
          <div className="absolute left-5 top-5 flex items-center gap-2 bg-[#f3f0e8]/90 px-3 py-2 font-mono text-[9px] uppercase tracking-[.13em] text-[#36544e]"><span className="h-2 w-2 rounded-full bg-[#4a8c72]" />Live provenance</div>
        </div>
        <div className="mt-3 flex justify-between font-mono text-[9px] uppercase tracking-[.14em] text-[#667570]"><span>One item / connected records</span><span>Fig. 01 — custody</span></div>
      </div>
    </section>
    <section className="bg-[#1c3835] px-5 py-16 text-[#f3f0e8] md:px-12 md:py-20">
      <div className="mx-auto max-w-[1320px]">
        <div className="flex flex-col justify-between gap-7 md:flex-row md:items-end"><div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-[#d9ad62]">How the record travels</p><h2 className="mt-4 max-w-2xl font-display text-4xl font-semibold tracking-[-.055em] md:text-6xl">One product.<br />Every accountable hand.</h2></div><p className="max-w-[380px] leading-7 text-[#bec9bc]">Each supply partner records their step in a shared history. The next custodian can confirm receipt before moving the goods onward.</p></div>
        <div className="relative mt-14 grid gap-8 border-t border-white/20 pt-8 md:grid-cols-4 md:gap-0">
          {[
            {n:'01',name:'Manufacturer',icon:Factory,detail:'Registers product identity, batch and origin.'},
            {n:'02',name:'Distributor',icon:Truck,detail:'Confirms receipt, then records the onward handoff.'},
            {n:'03',name:'Retailer',icon:Store,detail:'Receives inventory and marks it available for sale.'},
            {n:'04',name:'Customer',icon:ScanLine,detail:'Looks up the item and checks its recorded integrity.'},
          ].map((step,i)=><div key={step.n} className={`relative ${i?'md:border-l md:border-white/20 md:pl-7':''} md:pr-7`}>
            <span className="font-mono text-xs text-[#d9ad62]">{step.n}</span><step.icon className="my-7 text-[#d9ad62]" size={24}/><h3 className="font-display text-xl font-semibold">{step.name}</h3><p className="mt-2 max-w-[220px] text-sm leading-6 text-[#b9c5b9]">{step.detail}</p>
          </div>)}
        </div>
      </div>
    </section>
    <section className="mx-auto grid max-w-[1320px] gap-10 px-5 py-16 md:grid-cols-2 md:px-12 md:py-24">
      <div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-[#798b7e]">Clarity at each step</p><h2 className="mt-4 font-display text-4xl font-semibold leading-tight tracking-[-.055em] md:text-5xl">A useful record,<br />not another mystery.</h2></div>
      <div className="space-y-0">
        {[['01','Five exact custody states','See where the item sits in the supply process—from Created to Available for Sale.'],['02','Event-by-event history','Review who recorded a handoff and when it was added to the product timeline.'],['03','Ledger comparison','Check whether the current product record matches its stored blockchain hash.']].map(([n,title,desc])=><div key={n} className="flex gap-6 border-t border-[#d9d2c5] py-5"><span className="pt-1 font-mono text-[10px] text-[#bb8c42]">{n}</span><div><h3 className="font-display text-lg font-semibold">{title}</h3><p className="mt-1 max-w-md text-sm leading-6 text-[#63736c]">{desc}</p></div></div>)}
      </div>
    </section>
    <footer className="flex flex-col items-start justify-between gap-6 border-t border-[#d9d2c5] px-5 py-8 md:flex-row md:items-center md:px-12"><Brand/><p className="max-w-md text-xs leading-5 text-[#66746d]">Blockchain verification checks the stored record against the ledger; it does not establish the physical authenticity of an item.</p><Link href="/track" className="flex items-center gap-2 text-sm font-semibold" data-testid="link-footer-track">Look up a product <ArrowRight size={15}/></Link></footer>
  </main>;
}

function LoginPage() {
  const login = useLogin();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); setError(''); login.mutate({ data: { email, password } }, {
    onSuccess: (session) => { localStorage.setItem(TOKEN_KEY, session.token); localStorage.setItem(USER_KEY, JSON.stringify(session.user)); queryClient.setQueryData(getGetCurrentUserQueryKey(), session.user); setLocation('/dashboard'); },
    onError: (err) => setError(err instanceof Error ? err.message : 'We could not sign you in. Check your credentials and try again.'),
  }); };
  return <main className="app-shell grain min-h-[100dvh]">
    <PublicHeader /><div className="mx-auto grid max-w-6xl gap-12 px-5 py-12 md:grid-cols-[.9fr_1.1fr] md:items-center md:px-10 md:py-20">
      <div className="max-w-md"><p className="font-mono text-[10px] uppercase tracking-[.2em] text-[#788a7f]">Supply team access</p><h1 className="mt-5 font-display text-5xl font-semibold leading-[1.02] tracking-[-.06em]">The next handoff<br/>starts here.</h1><p className="mt-6 leading-7 text-[#62716c]">Sign in with your demo account to manage products and record custody events for your role.</p><div className="mt-9 border-l-2 border-[#d9ad62] pl-4 text-sm leading-6 text-[#596b64]">Choose your account credentials from the faculty demo environment.</div></div>
      <form onSubmit={submit} className="mx-auto w-full max-w-[480px] border border-[#d9d2c5] bg-[#faf8f1] p-6 md:p-10">
        <div className="mb-8 flex items-center gap-3"><LockKeyhole size={19} className="text-[#b88940]"/><div><h2 className="font-display text-xl font-semibold">Sign in</h2><p className="text-xs text-[#708079]">Role-scoped access to the chain ledger</p></div></div>
        <label className="mb-2 block text-xs font-semibold">Email address</label><input value={email} onChange={e=>setEmail(e.target.value)} type="email" autoComplete="username" required placeholder="name@organization.com" className="mb-5 w-full border border-[#d5cfc1] bg-transparent px-4 py-3 text-sm outline-none focus:border-[#557b70]" data-testid="input-login-email"/>
        <label className="mb-2 block text-xs font-semibold">Password</label><input value={password} onChange={e=>setPassword(e.target.value)} type="password" autoComplete="current-password" required placeholder="Enter your password" className="w-full border border-[#d5cfc1] bg-transparent px-4 py-3 text-sm outline-none focus:border-[#557b70]" data-testid="input-login-password"/>
        {error&&<p role="alert" className="mt-4 flex gap-2 text-sm text-[#a0443c]"><CircleAlert size={16}/>{error}</p>}
        <button disabled={login.isPending} className="mt-7 flex w-full items-center justify-center gap-3 bg-[#1c3835] px-5 py-4 text-sm font-semibold text-[#f4f0e8] disabled:opacity-60" data-testid="button-login">{login.isPending?<LoaderCircle size={17} className="animate-spin"/>:'Continue to workspace'}{!login.isPending&&<ArrowRight size={16}/>}</button>
        <Link href="/track" className="mt-6 flex justify-center text-sm text-[#5f726b] hover:text-[#1c3835]" data-testid="link-login-track">Continue without an account <ArrowRight size={14} className="ml-2"/></Link>
      </form>
    </div>
  </main>;
}

function TrackPage() {
  const [id, setId] = useState('');
  const [, setLocation] = useLocation();
  const submit = (e: FormEvent) => { e.preventDefault(); if (id.trim()) setLocation(`/verify/${encodeURIComponent(id.trim())}`); };
  return <main className="app-shell grain min-h-[100dvh]"><PublicHeader/><div className="mx-auto max-w-5xl px-5 py-12 md:px-10 md:py-20">
    <Link href="/" className="mb-12 inline-flex items-center gap-2 text-xs font-semibold text-[#687972]" data-testid="link-track-back"><ArrowLeft size={14}/> Return home</Link>
    <div className="grid gap-12 md:grid-cols-[1fr_.72fr] md:items-end"><div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-[#75887e]">Public product lookup</p><h1 className="mt-5 font-display text-5xl font-semibold leading-[1.02] tracking-[-.06em] md:text-7xl">Know where<br/>it’s been.</h1><p className="mt-6 max-w-lg text-lg leading-7 text-[#62716c]">Enter the product ID from its label to follow its recorded journey and check the integrity of its stored record.</p></div>
      <form onSubmit={submit} className="border border-[#d9d2c5] bg-[#faf8f1] p-5 md:p-7"><label className="mb-3 block font-mono text-[10px] uppercase tracking-[.16em] text-[#65776f]">Product ID</label><div className="flex border border-[#cec8bb] bg-[#f5f2e9]"><input value={id} onChange={e=>setId(e.target.value)} className="min-w-0 flex-1 bg-transparent px-4 py-4 font-mono text-sm outline-none" placeholder="e.g. PROD-0426" required data-testid="input-track-product"/><button className="m-1 flex items-center gap-2 bg-[#1c3835] px-4 text-xs font-semibold text-[#f6f0e4]" data-testid="button-track-submit">Look up <ArrowRight size={15}/></button></div><p className="mt-4 text-xs leading-5 text-[#78847b]">The ID is printed on the product record or shared by its supplier.</p></form>
    </div>
    <div className="mt-16 grid gap-4 border-t border-[#d9d2c5] pt-6 sm:grid-cols-3">{[['01','Find the record','Use the product ID.'],['02','Review the journey','Read its custody events.'],['03','Check stored integrity','Compare record to ledger.']].map(([n,title,desc])=><div className="flex gap-4" key={n}><span className="font-mono text-xs text-[#bb8c42]">{n}</span><div><p className="font-display font-semibold">{title}</p><p className="mt-1 text-xs text-[#728079]">{desc}</p></div></div>)}</div>
  </div></main>;
}

function VerifyPage() {
  const [, params] = useRoute('/verify/:productId');
  const id = params?.productId ?? '';
  const result = useVerifyProduct(id, { query: { enabled: !!id, queryKey: getVerifyProductQueryKey(id), retry: false } });
  return <PublicFrame><div className="mx-auto max-w-5xl px-5 py-10 md:px-10 md:py-14">
    <Link href="/track" className="inline-flex items-center gap-2 text-xs font-semibold text-[#687972]" data-testid="link-verification-back"><ArrowLeft size={14}/> Track another item</Link>
    <div className="mt-10 grid gap-8 md:grid-cols-[1fr_.8fr]"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-[#77877d]">Record integrity check</p><h1 className="mt-4 font-display text-4xl font-semibold tracking-[-.05em] md:text-6xl">Verification</h1><p className="mt-3 font-mono text-sm text-[#687872]" data-testid="text-verify-product-id">{id}</p>
      {result.isLoading?<SkeletonBlock/>:result.isError?<ErrorPanel title="Could not verify this product" detail="Check the product ID and try the integrity check again." retry={()=>void result.refetch()}/>:result.data?<div className={`mt-8 border p-6 ${result.data.verified?'border-[#a9c1ae] bg-[#e4eee3]':'border-[#dfb5a8] bg-[#f5e5df]'}`}><div className="flex items-start gap-4">{result.data.verified?<CheckCircle2 className="mt-1 text-[#36715e]"/>:<CircleAlert className="mt-1 text-[#a0443c]"/>}<div><h2 className="font-display text-2xl font-semibold">{result.data.verified?'Record matches ledger':'Record does not match'}</h2><p className="mt-2 text-sm leading-6 text-[#50645b]">{result.data.message}</p><p className="mt-4 text-xs leading-5 text-[#64736b]">This comparison verifies the stored product record against the ledger. It does not prove the physical authenticity of an item.</p></div></div></div>:null}
    </div><aside className="border border-[#d9d2c5] bg-[#faf8f1] p-6 md:p-8"><div className="flex items-center gap-3"><Fingerprint className="text-[#bb8c42]"/><h2 className="font-display text-xl font-semibold">What is checked</h2></div><div className="mt-6 space-y-5">{[['Product record hash',result.data?.productHash],['Ledger hash',result.data?.blockchainHash]].map(([label,value])=><div className="border-t border-[#e2ddd2] pt-4" key={label}><p className="mb-2 text-[10px] uppercase tracking-[.14em] text-[#78857c]">{label}</p><p className="break-all font-mono text-xs leading-5 text-[#294943]">{result.isLoading?'Comparing stored values…':(value as string)||'—'}</p></div>)}</div><div className="mt-6 flex gap-2 text-xs leading-5 text-[#748077]"><ShieldCheck size={15} className="mt-0.5 shrink-0"/>A successful check means the stored values match, not that the item itself has been physically inspected.</div></aside></div>
    {result.data?.product&&<ProductSummary product={result.data.product}/>}
  </div></PublicFrame>;
}

function PublicFrame({children}:{children:ReactNode}) { return <main className="app-shell grain min-h-[100dvh]"><PublicHeader/>{children}</main>; }

function getStoredUser(): User | null { try { const raw=localStorage.getItem(USER_KEY); return raw?JSON.parse(raw) as User:null; } catch { return null; } }
function Protected({children}:{children:(user:User)=>ReactNode}) {
  const [,setLocation]=useLocation();
  const current=useGetCurrentUser({query:{enabled:!!localStorage.getItem(TOKEN_KEY),queryKey:getGetCurrentUserQueryKey(),retry:false}});
  const cached=getStoredUser();
  useEffect(()=>{ if(!localStorage.getItem(TOKEN_KEY)){setLocation('/login');} },[setLocation]);
  if(!localStorage.getItem(TOKEN_KEY))return <LoadingWorkspace/>;
  if(current.isLoading&&!current.data&&!cached)return <LoadingWorkspace/>;
  if(current.isError&&!cached){localStorage.removeItem(TOKEN_KEY);setTimeout(()=>setLocation('/login'),0);return <LoadingWorkspace/>;}
  const user=current.data??cached;
  return user?children(user):<LoadingWorkspace/>;
}

function Workspace({user,children,title,eyebrow,action}:{user:User;children:ReactNode;title:string;eyebrow:string;action?:ReactNode}) {
  const [location]=useLocation();const [mobileOpen,setMobileOpen]=useState(false);
  const links=[{to:'/dashboard',label:'Overview',icon:Activity},{to:'/products',label:'Products',icon:Box}];
  const [,setLocation]=useLocation();
  const logout=()=>{localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(USER_KEY);queryClient.clear();setLocation('/login');};
  return <div className="app-shell grain min-h-[100dvh] md:flex">
    <aside className={`${mobileOpen?'fixed inset-0 z-30':'hidden'} h-[100dvh] w-[248px] shrink-0 flex-col bg-[#1c3835] text-[#f2eee5] md:sticky md:top-0 md:flex`}>
      <div className="flex h-[82px] items-center justify-between border-b border-white/10 px-6"><Brand inverse/><button onClick={()=>setMobileOpen(false)} className="md:hidden" aria-label="Close menu"><X/></button></div>
      <div className="px-5 pt-8"><p className="mb-3 px-3 font-mono text-[9px] uppercase tracking-[.2em] text-[#99aaa0]">Workspace</p>{links.map(item=><Link key={item.to} href={item.to} onClick={()=>setMobileOpen(false)} className={`mb-1 flex items-center gap-3 px-3 py-3 text-sm transition ${location===item.to?'bg-[#2a4c46] text-[#e5c47d]':'text-[#d1d8d0] hover:bg-white/5'}`} data-testid={`link-sidebar-${item.label.toLowerCase()}`}><item.icon size={17}/>{item.label}{location===item.to&&<ChevronRight size={14} className="ml-auto"/>}</Link>)}</div>
      {user.role==='manufacturer'&&<div className="mx-5 mt-6 border-t border-white/10 pt-5"><Link href="/products/new" className="flex items-center gap-3 border border-white/20 px-3 py-3 text-sm text-[#f0d08a] hover:bg-white/5" data-testid="link-sidebar-register"><PackagePlus size={17}/> Register product <ArrowRight size={14} className="ml-auto"/></Link></div>}
      <div className="mt-auto border-t border-white/10 p-5"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center bg-[#d9ad62] font-display font-semibold text-[#1c3835]">{user.name.slice(0,1).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{user.name}</p><p className="mt-0.5 text-[10px] uppercase tracking-[.14em] text-[#a7b7aa]">{roleTitle(user.role)}</p></div><button onClick={logout} className="p-2 text-[#a7b7aa] hover:text-white" title="Sign out" data-testid="button-logout"><LogOut size={16}/></button></div></div>
    </aside>
    <div className="min-w-0 flex-1">
      <header className="flex h-[70px] items-center justify-between border-b border-[#d9d2c5] bg-[#f7f4ec] px-5 md:px-9"><div className="flex items-center gap-3"><button className="md:hidden" onClick={()=>setMobileOpen(true)} aria-label="Open menu"><Menu size={20}/></button><div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#738078]">Operations <span className="px-1.5">/</span> <span className="text-[#28443e]">{title}</span></div></div><div className="flex items-center gap-3"><span className="hidden font-mono text-[9px] uppercase tracking-[.13em] text-[#7b887f] sm:block">Chain ledger / Demo network</span><span className="h-2 w-2 rounded-full bg-[#579477]"/></div></header>
      <main className="mx-auto max-w-[1440px] px-5 pb-12 pt-8 md:px-9 md:pt-10"><div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="font-mono text-[9px] uppercase tracking-[.19em] text-[#79887f]">{eyebrow}</p><h1 className="mt-2 font-display text-3xl font-semibold tracking-[-.05em] md:text-[42px]">{title}</h1></div>{action}</div>{children}</main>
    </div>
  </div>;
}

function DashboardPage(){return <Protected>{user=><DashboardContent user={user}/>}</Protected>}
function DashboardContent({user}:{user:User}) {
  const stats=useGetDashboardStats();const products=useGetProducts();
  const latest=(products.data??[]).slice(0,5);
  const metric=[
    {label:'Total products',value:stats.data?.totalProducts,icon:Layers3,accent:'text-[#315b53]',note:'Visible in your scope'},
    {label:'Created',value:stats.data?.created,icon:PackagePlus,accent:'text-[#af8342]',note:'Awaiting first handoff'},
    {label:'In supply chain',value:stats.data?.inSupplyChain,icon:Truck,accent:'text-[#597a70]',note:'Moving between partners'},
    {label:'Available for sale',value:stats.data?.available,icon:Store,accent:'text-[#507969]',note:'At retail' },
  ];
  return <Workspace user={user} title="Overview" eyebrow="Supply chain pulse" action={user.role==='manufacturer'?<Link href="/products/new" className="flex items-center gap-2 bg-[#1c3835] px-4 py-3 text-xs font-semibold text-[#f5f0e7]" data-testid="link-dashboard-new"><PackagePlus size={15}/> Register product</Link>:null}>
    {stats.isError?<ErrorPanel title="Dashboard totals are unavailable" detail="The service could not load the latest role-scoped figures." retry={()=>void stats.refetch()}/>:<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metric.map((m,i)=><div key={m.label} className="border border-[#d9d2c5] bg-[#faf8f1] p-5 fade-up" style={{animationDelay:`${i*55}ms`}}><div className="flex items-center justify-between"><span className="text-xs text-[#6d7b73]">{m.label}</span><m.icon size={17} className={m.accent}/></div><p className="mt-5 font-display text-[38px] font-semibold leading-none tracking-[-.055em]">{stats.isLoading?<span className="inline-block h-9 w-14 animate-pulse bg-[#e3ded2]"/>:m.value??'—'}</p><p className="mt-3 text-[10px] text-[#859087]">{m.note}</p></div>)}</div>}
    <div className="mt-7 grid gap-5 xl:grid-cols-[1.5fr_.8fr]">
      <section className="border border-[#d9d2c5] bg-[#faf8f1]"><div className="flex items-center justify-between border-b border-[#e3ded3] px-5 py-4"><div><h2 className="font-display text-lg font-semibold">Recent product records</h2><p className="mt-1 text-xs text-[#79857d]">Latest items in your supply scope</p></div><Link href="/products" className="flex items-center gap-2 text-xs font-semibold text-[#42645b]" data-testid="link-dashboard-all-products">All products <ArrowRight size={14}/></Link></div>
        {products.isLoading?<div className="space-y-3 p-5"><SkeletonLine/><SkeletonLine/><SkeletonLine/></div>:products.isError?<ErrorPanel title="Products could not be loaded" detail="Try refreshing the records." retry={()=>void products.refetch()}/>:latest.length===0?<EmptyPanel icon={Box} title="No products in view yet" detail="Product records will appear here once they enter your role’s supply scope."/>:<div className="divide-y divide-[#e7e2d8]">{latest.map(p=><ProductRow key={p.productId} product={p}/>)}</div>}
      </section>
      <section className="border border-[#d9d2c5] bg-[#e9e6db] p-5 md:p-6"><div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.16em] text-[#6b7a71]"><Activity size={14}/> Custody sequence</div><h2 className="mt-3 font-display text-xl font-semibold">Five defined states.</h2><p className="mt-2 text-sm leading-6 text-[#68776e]">Each state marks a recorded handoff in the chain. Select a product to review its complete event history.</p><div className="mt-6 space-y-0">{STATUS.map((s,i)=>{const Icon=statusIcon(s);return <div key={s} className="flex items-center gap-3 border-t border-[#d3d0c4] py-3"><span className={`flex h-7 w-7 items-center justify-center ${i<2?'bg-[#d9ad62] text-[#263f39]':'border border-[#bcb9ac] text-[#6d7a70]'}`}><Icon size={14}/></span><div className="flex-1"><p className="text-xs font-semibold">{s}</p></div><span className="font-mono text-[9px] text-[#8b9287]">0{i+1}</span></div>})}</div></section>
    </div>
  </Workspace>;
}

function ProductsPage(){return <Protected>{user=><ProductsContent user={user}/>}</Protected>}
function ProductsContent({user}:{user:User}) {
  const query=useGetProducts();const [term,setTerm]=useState('');const [status,setStatus]=useState('All statuses');
  const products=query.data??[];
  const filtered=products.filter(p=>`${p.productName} ${p.productId} ${p.batchNumber} ${p.category}`.toLowerCase().includes(term.toLowerCase())&&(status==='All statuses'||p.currentStatus===status));
  return <Workspace user={user} title="Products" eyebrow={`${products.length} records in scope`} action={user.role==='manufacturer'?<Link href="/products/new" className="flex items-center gap-2 bg-[#1c3835] px-4 py-3 text-xs font-semibold text-[#f5f0e7]" data-testid="link-products-new"><PackagePlus size={15}/> Register product</Link>:null}>
    <section className="border border-[#d9d2c5] bg-[#faf8f1]">
      <div className="flex flex-col gap-3 border-b border-[#e3ded3] p-4 sm:flex-row"><label className="flex flex-1 items-center gap-3 border border-[#ddd7ca] bg-[#f7f4ec] px-3"><Search size={16} className="text-[#819087]"/><input value={term} onChange={e=>setTerm(e.target.value)} placeholder="Search product, ID, batch…" className="w-full bg-transparent py-3 text-sm outline-none" data-testid="input-product-search"/></label><select value={status} onChange={e=>setStatus(e.target.value)} className="border border-[#ddd7ca] bg-[#f7f4ec] px-3 py-3 text-xs outline-none" data-testid="select-product-status"><option>All statuses</option>{STATUS.map(s=><option key={s}>{s}</option>)}</select></div>
      {query.isLoading?<div className="space-y-4 p-5"><SkeletonLine/><SkeletonLine/><SkeletonLine/></div>:query.isError?<ErrorPanel title="Product list unavailable" detail="Refresh to try loading role-scoped product records." retry={()=>void query.refetch()}/>:filtered.length===0?<EmptyPanel icon={term||status!=='All statuses'?Search:Box} title={term||status!=='All statuses'?'No matching products':'No products in your scope'} detail={term||status!=='All statuses'?'Adjust the search or status filter to see more records.':'Products appear here as they move through the chain.'}/>:<div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="bg-[#f1eee5] font-mono text-[9px] uppercase tracking-[.14em] text-[#78857c]"><tr><th className="px-5 py-3 font-normal">Product / ID</th><th className="px-4 py-3 font-normal">Batch</th><th className="px-4 py-3 font-normal">Category</th><th className="px-4 py-3 font-normal">Quantity</th><th className="px-4 py-3 font-normal">Current status</th><th className="px-5 py-3 font-normal">Added</th></tr></thead><tbody className="divide-y divide-[#e8e3d9]">{filtered.map(p=><ProductTableRow key={p.productId} product={p}/>)}</tbody></table></div>}
    </section>
    <p className="mt-4 flex items-center gap-2 text-[10px] text-[#7d8981]"><ShieldCheck size={14}/> Product visibility is scoped by your role and current chain position.</p>
  </Workspace>;
}

function ProductTableRow({product:p}:{product:Product}) {
  const Icon=statusIcon(p.currentStatus);
  return <tr className="hover:bg-[#f6f3ec]"><td className="px-5 py-4"><Link href={`/products/${encodeURIComponent(p.productId)}`} className="block" data-testid={`link-product-${p.productId}`}><p className="font-display text-sm font-semibold">{p.productName}</p><p className="mt-1 font-mono text-[10px] text-[#7a887f]">{p.productId}</p></Link></td><td className="px-4 py-4 font-mono text-xs">{p.batchNumber}</td><td className="px-4 py-4 text-xs">{p.category}</td><td className="px-4 py-4 font-mono text-xs">{p.quantity.toLocaleString()}</td><td className="px-4 py-4"><StatusPill status={p.currentStatus} compact/></td><td className="px-5 py-4 text-xs text-[#6c7a71]">{dateLabel(p.createdAt)}</td></tr>;
}
function ProductRow({product:p}:{product:Product}) {
  return <Link href={`/products/${encodeURIComponent(p.productId)}`} className="flex items-center gap-4 px-5 py-4 transition hover:bg-[#f5f2ea]" data-testid={`link-recent-product-${p.productId}`}><span className="flex h-10 w-10 shrink-0 items-center justify-center bg-[#e7e4d9] text-[#42635a]"><Box size={18}/></span><span className="min-w-0 flex-1"><span className="block truncate font-display text-sm font-semibold">{p.productName}</span><span className="mt-1 block font-mono text-[9px] text-[#7b887f]">{p.productId} <span className="px-1">/</span> {p.batchNumber}</span></span><StatusPill status={p.currentStatus} compact/><ChevronRight size={15} className="text-[#9da399]"/></Link>;
}

function NewProductPage(){return <Protected>{user=><NewProductContent user={user}/>}</Protected>}
function NewProductContent({user}:{user:User}) {
  const mutation=useCreateProduct();const client=useQueryClient();const [,setLocation]=useLocation();const [error,setError]=useState('');
  const submit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();setError('');const f=new FormData(e.currentTarget);const data:ProductInput={productId:String(f.get('productId')).trim(),productName:String(f.get('productName')).trim(),batchNumber:String(f.get('batchNumber')).trim(),category:String(f.get('category')),manufacturingDate:String(f.get('manufacturingDate')),quantity:Number(f.get('quantity')),description:String(f.get('description')).trim()};
    mutation.mutate({data},{onSuccess:(product)=>{void client.invalidateQueries({queryKey:getGetProductsQueryKey()});void client.invalidateQueries({queryKey:getGetDashboardStatsQueryKey()});setLocation(`/products/${encodeURIComponent(product.productId)}`);},onError:err=>setError(err instanceof Error?err.message:'Product registration could not be completed.')});
  };
  if(user.role!=='manufacturer')return <Workspace user={user} title="Register product" eyebrow="Manufacturer access required"><EmptyPanel icon={LockKeyhole} title="Manufacturer access required" detail="Only manufacturer accounts can register new product records."/></Workspace>;
  return <Workspace user={user} title="Register product" eyebrow="New product record" action={<Link href="/products" className="flex items-center gap-2 text-xs font-semibold text-[#61746a]" data-testid="link-register-cancel"><ArrowLeft size={14}/> Product list</Link>}>
    <div className="grid gap-6 xl:grid-cols-[1fr_320px]"><form onSubmit={submit} className="border border-[#d9d2c5] bg-[#faf8f1]">
      <div className="border-b border-[#e3ded3] px-5 py-4 md:px-7"><h2 className="font-display text-lg font-semibold">Identity and origin</h2><p className="mt-1 text-xs text-[#79857d]">Record the product details that anchor its custody history.</p></div>
      <div className="grid gap-x-5 gap-y-5 p-5 md:grid-cols-2 md:p-7">
        <Field name="productName" label="Product name" placeholder="e.g. Northfield olive oil" required/>
        <Field name="productId" label="Product ID" placeholder="e.g. NF-OLV-0426" required mono/>
        <Field name="batchNumber" label="Batch number" placeholder="e.g. LOT-24-A" required mono/>
        <label className="block"><span className="mb-2 block text-xs font-semibold">Category</span><select name="category" required defaultValue="" className="w-full border border-[#d5cfc1] bg-[#f7f4ec] px-3 py-3 text-sm outline-none focus:border-[#557b70]" data-testid="input-new-category"><option value="" disabled>Select category</option>{['Food & beverage','Apparel','Electronics','Personal care','Home goods','Other'].map(c=><option key={c}>{c}</option>)}</select></label>
        <Field name="manufacturingDate" label="Manufacturing date" type="date" required/>
        <Field name="quantity" label="Quantity" type="number" min="1" placeholder="0" required/>
        <label className="block md:col-span-2"><span className="mb-2 block text-xs font-semibold">Description</span><textarea name="description" rows={3} placeholder="A concise description of this product and batch." className="w-full resize-y border border-[#d5cfc1] bg-[#f7f4ec] px-3 py-3 text-sm outline-none focus:border-[#557b70]" data-testid="input-new-description"/></label>
      </div>
      {error&&<p role="alert" className="mx-5 flex gap-2 text-sm text-[#a0443c] md:mx-7"><CircleAlert size={16}/>{error}</p>}
      <div className="flex flex-col justify-between gap-4 border-t border-[#e3ded3] px-5 py-4 sm:flex-row sm:items-center md:px-7"><p className="flex items-center gap-2 text-[10px] text-[#79857d]"><ShieldCheck size={14}/> Registration creates the first custody record.</p><button disabled={mutation.isPending} className="flex items-center justify-center gap-2 bg-[#1c3835] px-5 py-3 text-xs font-semibold text-[#f5f0e7] disabled:opacity-60" data-testid="button-register-product">{mutation.isPending?<LoaderCircle size={15} className="animate-spin"/>:<PackagePlus size={15}/>} Register product <ArrowRight size={14}/></button></div>
    </form><aside className="h-fit border border-[#d9d2c5] bg-[#e9e6db] p-5"><div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.16em] text-[#6e7b72]"><Clipboard size={14}/> Before you register</div><h3 className="mt-4 font-display text-xl font-semibold">Keep the ID stable.</h3><p className="mt-2 text-sm leading-6 text-[#69776f]">The product ID is used to retrieve the public record and generate its verification link. Check it against the printed product identifier.</p><div className="mt-5 border-t border-[#d3d0c4] pt-4 text-xs leading-5 text-[#68776d]">New records enter the chain with status <strong className="font-semibold text-[#294a43]">Created</strong>.</div></aside></div>
  </Workspace>;
}
function Field({name,label,placeholder,type='text',required,min,mono}:{name:string;label:string;placeholder?:string;type?:string;required?:boolean;min?:string;mono?:boolean}){return <label className="block"><span className="mb-2 block text-xs font-semibold">{label}</span><input name={name} type={type} placeholder={placeholder} min={min} required={required} className={`w-full border border-[#d5cfc1] bg-[#f7f4ec] px-3 py-3 text-sm outline-none focus:border-[#557b70] ${mono?'font-mono':''}`} data-testid={`input-new-${name}`}/></label>}

function ProductPage(){const [,params]=useRoute('/products/:productId');return <Protected>{user=><ProductContent user={user} id={params?.productId??''}/>}</Protected>}
function ProductContent({user,id}:{user:User;id:string}) {
  const client=useQueryClient();const product=useGetProduct(id,{query:{enabled:!!id,queryKey:getGetProductQueryKey(id),retry:false}});const events=useGetProductEvents(id,{query:{enabled:!!id,queryKey:getGetProductEventsQueryKey(id),retry:false}});
  const dReceive=useDistributorReceive();const dTransfer=useDistributorTransfer();const rReceive=useRetailerReceive();const available=useMarkProductAvailable();
  const [actionError,setActionError]=useState('');const [copied,setCopied]=useState(false);
  const qrCanvas=useRef<HTMLCanvasElement>(null);
  const verifyUrl=getVerificationUrl(id);
  const p=product.data?.product;
  const onSuccess=()=>{setActionError('');void client.invalidateQueries({queryKey:getGetProductQueryKey(id)});void client.invalidateQueries({queryKey:getGetProductEventsQueryKey(id)});void client.invalidateQueries({queryKey:getGetProductsQueryKey()});void client.invalidateQueries({queryKey:getGetDashboardStatsQueryKey()});};
  const busy=dReceive.isPending||dTransfer.isPending||rReceive.isPending||available.isPending;
  const action=()=>{
    setActionError('');
    const callbacks={onSuccess,onError:(e:Error)=>setActionError(e.message||'The custody event could not be recorded.')};
    if(user.role==='distributor'&&p?.currentStatus==='Created')dReceive.mutate({productId:id},callbacks);
    else if(user.role==='distributor'&&p?.currentStatus==='Received by Distributor')dTransfer.mutate({productId:id},callbacks);
    else if(user.role==='retailer'&&p?.currentStatus==='In Transit to Retailer')rReceive.mutate({productId:id},callbacks);
    else if(user.role==='retailer'&&p?.currentStatus==='Received by Retailer')available.mutate({productId:id},callbacks);
  };
  const actionLabel=user.role==='distributor'?(p?.currentStatus==='Created'?'Confirm receipt':p?.currentStatus==='Received by Distributor'?'Transfer to retailer':null):user.role==='retailer'?(p?.currentStatus==='In Transit to Retailer'?'Confirm receipt':p?.currentStatus==='Received by Retailer'?'Mark available for sale':null):null;
  const copy=async()=>{await navigator.clipboard?.writeText(verifyUrl);setCopied(true);window.setTimeout(()=>setCopied(false),1800);};
  const downloadQr=()=>{const canvas=qrCanvas.current;if(!canvas)return;const anchor=document.createElement('a');anchor.href=canvas.toDataURL('image/png');anchor.download=`${id}-verification.png`;anchor.click();};
  return <Workspace user={user} title={p?.productName??'Product record'} eyebrow={`Product / ${id}`} action={<Link href="/products" className="flex items-center gap-2 text-xs font-semibold text-[#61746a]" data-testid="link-detail-back"><ArrowLeft size={14}/> All products</Link>}>
    {product.isLoading?<div className="space-y-4"><SkeletonBlock/><SkeletonBlock/></div>:product.isError||!p?<ErrorPanel title="Product record unavailable" detail="The product may be outside your role’s scope or the ID may not exist." retry={()=>void product.refetch()}/>:<>
      <div className="grid gap-5 xl:grid-cols-[1fr_300px]"><section className="border border-[#d9d2c5] bg-[#faf8f1]">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#e3ded3] p-5 md:p-7"><div className="flex gap-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center bg-[#e8e5da] text-[#45675d]"><Box size={22}/></span><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-[#75847a]">{p.category}</p><h2 className="mt-1 font-display text-2xl font-semibold tracking-[-.04em] md:text-3xl">{p.productName}</h2><p className="mt-2 font-mono text-xs text-[#77857c]">{p.productId} <span className="px-1">/</span> Batch {p.batchNumber}</p></div></div><StatusPill status={p.currentStatus}/></div>
        <div className="grid gap-5 p-5 sm:grid-cols-2 md:grid-cols-4 md:p-7">{[['Quantity',p.quantity.toLocaleString()],['Manufactured',dateLabel(p.manufacturingDate)],['Manufacturer',p.manufacturer],['Created',dateLabel(p.createdAt)]].map(([label,value])=><div key={label}><p className="font-mono text-[9px] uppercase tracking-[.14em] text-[#7c8980]">{label}</p><p className="mt-2 text-sm font-semibold">{value}</p></div>)}</div>
        {p.description&&<div className="border-t border-[#e3ded3] px-5 py-4 text-sm leading-6 text-[#69776f] md:px-7">{p.description}</div>}
        {actionLabel&&<div className="flex flex-col justify-between gap-3 border-t border-[#e3ded3] bg-[#f4f1e8] px-5 py-4 sm:flex-row sm:items-center md:px-7"><p className="text-xs text-[#63746a]">Your {roleTitle(user.role).toLowerCase()} handoff is ready to record.</p><button onClick={action} disabled={busy} className="flex items-center justify-center gap-2 bg-[#1c3835] px-4 py-3 text-xs font-semibold text-[#f5f0e7] disabled:opacity-60" data-testid="button-supply-action">{busy?<LoaderCircle size={15} className="animate-spin"/>:<Check size={15}/>} {actionLabel} <ArrowRight size={14}/></button></div>}
        {actionError&&<p role="alert" className="p-4 text-sm text-[#a0443c]">{actionError}</p>}
      </section>
      <aside className="border border-[#d9d2c5] bg-[#e9e6db] p-5"><div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.16em] text-[#6d7a70]"><QrCode size={15}/> Public verification</div><h3 className="mt-3 font-display text-xl font-semibold">Scan to check.</h3><p className="mt-1 text-xs leading-5 text-[#718077]">Open the public record integrity check for this product.</p><Link href={`/verify/${encodeURIComponent(id)}`} aria-label="Open product verification" className="mt-5 flex justify-center border border-[#d9d2c5] bg-white p-3" data-testid={`link-verify-${id}`}><QRCodeCanvas ref={qrCanvas} value={verifyUrl} size={168} level="H" includeMargin bgColor="#ffffff" fgColor="#183b37"/></Link><p className="mt-4 break-all font-mono text-[9px] leading-4 text-[#718077]">{verifyUrl}</p><div className="mt-4 grid grid-cols-2 gap-2"><button onClick={copy} className="flex items-center justify-center gap-2 border border-[#bdbbac] px-2 py-2.5 text-[10px] font-semibold hover:bg-[#dfdccf]" data-testid="button-copy-verify">{copied?<Check size={13}/>:<Clipboard size={13}/>} {copied?'Copied':'Copy link'}</button><button onClick={downloadQr} className="flex items-center justify-center gap-2 bg-[#1c3835] px-2 py-2.5 text-[10px] font-semibold text-[#f5f0e7] hover:bg-[#28524d]" data-testid="button-download-qr"><QrCode size={13}/> Download PNG</button></div></aside></div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_.8fr]"><section className="border border-[#d9d2c5] bg-[#faf8f1]"><div className="border-b border-[#e3ded3] px-5 py-4"><div className="flex items-center gap-2"><Clock3 size={16} className="text-[#b98942]"/><h2 className="font-display text-lg font-semibold">Custody timeline</h2></div><p className="mt-1 text-xs text-[#7b887f]">Recorded events for this product</p></div>
        {events.isLoading?<div className="space-y-4 p-5"><SkeletonLine/><SkeletonLine/></div>:events.isError?<ErrorPanel title="Timeline unavailable" detail="The product loaded, but its events could not be retrieved." retry={()=>void events.refetch()}/>:!events.data?.length?<EmptyPanel icon={Clock3} title="No custody events recorded" detail="The timeline will fill as supply partners record handoffs."/>:<div className="p-5 md:p-7">{events.data.map((event,i)=>{const Icon=statusIcon(event.status);return <div key={event.id} className="relative flex gap-4 pb-6 last:pb-0"><div className="flex flex-col items-center"><span className={`z-[1] flex h-9 w-9 items-center justify-center ${i===0?'bg-[#d9ad62] text-[#263f39]':'bg-[#e8e5da] text-[#527168]'}`}><Icon size={16}/></span>{i<events.data!.length-1&&<span className="absolute bottom-0 top-9 w-px bg-[#d9d2c5]"/>}</div><div className="min-w-0 flex-1 pt-0.5"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-display text-sm font-semibold">{event.eventType}</h3><p className="mt-1 text-xs text-[#738077]">{event.status}</p></div><time className="font-mono text-[9px] text-[#7e8b81]">{new Date(event.timestamp).toLocaleString()}</time></div><p className="mt-2 text-xs text-[#6a7970]">{event.actor} <span className="text-[#9aa197]">/</span> {roleTitle(event.actorRole)}</p><p className="mt-2 flex items-center gap-1.5 font-mono text-[9px] text-[#7d8a80]"><Link2 size={11}/>{shortHash(event.blockchainTransaction)}</p></div></div>})}</div>}
      </section>
      <section className="border border-[#d9d2c5] bg-[#faf8f1]"><div className="border-b border-[#e3ded3] px-5 py-4"><div className="flex items-center gap-2"><Fingerprint size={16} className="text-[#b98942]"/><h2 className="font-display text-lg font-semibold">Record fingerprints</h2></div><p className="mt-1 text-xs text-[#7b887f]">Stored values for ledger comparison</p></div><div className="space-y-0 px-5">{[['Product hash',p.productHash],['Blockchain hash',p.blockchainHash],['Transaction reference',p.blockchainTransaction]].map(([label,value])=><div key={label} className="border-b border-[#e8e3d9] py-4 last:border-0"><p className="font-mono text-[9px] uppercase tracking-[.13em] text-[#7b887f]">{label}</p><p className="mt-2 break-all font-mono text-[10px] leading-5 text-[#31564e]">{value||'—'}</p></div>)}</div><Link href={`/verify/${encodeURIComponent(id)}`} className="mx-5 mb-5 mt-1 flex items-center justify-between border border-[#d9d2c5] px-4 py-3 text-xs font-semibold hover:bg-[#f4f1e9]" data-testid="link-integrity-check">Run public integrity check <ArrowRight size={14}/></Link></section></div>
    </>}
  </Workspace>;
}

function ProductSummary({product:p}:{product:Product}){return <div className="mt-8 border-t border-[#d9d2c5] pt-6"><p className="font-mono text-[9px] uppercase tracking-[.16em] text-[#78857c]">Product record</p><h2 className="mt-2 font-display text-2xl font-semibold">{p.productName}</h2><p className="mt-1 font-mono text-xs text-[#728078]">{p.productId} / Batch {p.batchNumber}</p><Link href={`/track`} className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-[#45655c]" data-testid="link-verify-track">Look up another item <ArrowRight size={14}/></Link></div>}

function StatusPill({status,compact=false}:{status:string;compact?:boolean}) {
  const index=STATUS.indexOf(status);const palette=index===4?'bg-[#e0ebe0] text-[#3f7058]':index===2?'bg-[#efe9d8] text-[#96743a]':index===3?'bg-[#e5eadd] text-[#567253]':'bg-[#e6e8df] text-[#50635a]';
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${compact?'px-2 py-1 text-[9px]':'px-3 py-1.5 text-[10px]'} ${palette}`} data-testid={`status-product-${status.toLowerCase().replaceAll(' ','-')}`}><span className="h-1.5 w-1.5 rounded-full bg-current"/>{status}</span>;
}
function SkeletonLine(){return <div className="h-10 animate-pulse bg-[#e9e5da]"/>}
function SkeletonBlock(){return <div className="h-36 animate-pulse border border-[#ded9ce] bg-[#ede9de]"/>}
function LoadingWorkspace(){return <div className="app-shell flex min-h-[100dvh] items-center justify-center"><div className="w-full max-w-3xl px-6"><div className="h-10 w-48 animate-pulse bg-[#e3ded2]"/><div className="mt-8 grid gap-3 sm:grid-cols-3"><SkeletonBlock/><SkeletonBlock/><SkeletonBlock/></div></div></div>}
function ErrorPanel({title,detail,retry}:{title:string;detail:string;retry:()=>void}){return <div className="m-5 flex gap-3 border border-[#e1c8bb] bg-[#f7eae3] p-4"><CircleAlert size={17} className="mt-0.5 shrink-0 text-[#a34f41]"/><div className="flex-1"><p className="text-sm font-semibold text-[#553a32]">{title}</p><p className="mt-1 text-xs leading-5 text-[#775c51]">{detail}</p><button onClick={retry} className="mt-3 text-xs font-semibold text-[#8a473a] underline underline-offset-2" data-testid="button-retry">Try again</button></div></div>}
function EmptyPanel({icon:Icon,title,detail}:{icon:typeof Box;title:string;detail:string}){return <div className="flex flex-col items-center px-6 py-12 text-center"><span className="flex h-12 w-12 items-center justify-center bg-[#ece9de] text-[#54736a]"><Icon size={20}/></span><h3 className="mt-4 font-display text-lg font-semibold">{title}</h3><p className="mt-2 max-w-sm text-sm leading-6 text-[#79857c]">{detail}</p></div>}

export default App;
