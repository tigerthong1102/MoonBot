const defaultModelPrice = { input:0.4, output:1.6 };
const assumptions = {
  requestsPerUser:30, tokensIn:1000, tokensOut:250, reasoningTokens:0,
  managedShare:0.8, payingShare:0.03, monthlyPrice:3, feeShare:0.04, feeFixed:0.30,
  computeBase:15, computePerUser:0.002, databaseBase:5, databasePerUser:0.001,
  storedBytesPerTurn:8000, monthsStored:3, storagePerGB:0.03, bytesSentPerTurn:10000,
  egressPerGB:0.10, fileGB:0,
};
function unitInference(a, price) {
  return (a.tokensIn*price.input + (a.tokensOut+a.reasoningTokens)*price.output)/1e6*a.requestsPerUser;
}
function estimate(mau, a, price) {
  const turns = mau*a.requestsPerUser;
  const managed = mau*a.managedShare*unitInference(a,price);
  const revenue = mau*a.payingShare*a.monthlyPrice;
  const fees = mau*a.payingShare*(a.monthlyPrice*a.feeShare+a.feeFixed);
  const compute = a.computeBase+mau*a.computePerUser, database = a.databaseBase+mau*a.databasePerUser;
  const storageGB = turns*a.storedBytesPerTurn*a.monthsStored/1e9+a.fileGB;
  const storage = storageGB*a.storagePerGB, network = turns*a.bytesSentPerTurn/1e9*a.egressPerGB;
  const cost = managed+fees+compute+database+storage+network;
  const round = x => Number(x.toFixed(2));
  return { mau, managed:round(managed), byokPaidByUser:round(mau*(1-a.managedShare)*unitInference(a,price)),
    compute:round(compute), database:round(database), storageGB:round(storageGB), storage:round(storage),
    network:round(network), fees:round(fees), revenue:round(revenue), grossProfit:round(revenue-cost),
    grossMarginPercent:revenue ? round(100*(revenue-cost)/revenue) : null };
}
const sizes = [1000,10000,100000,1000000];
const free = { ...assumptions, managedShare:1, payingShare:0 };
const freeMarginal = unitInference(free,defaultModelPrice)+free.computePerUser+free.databasePerUser+
  free.requestsPerUser*(free.storedBytesPerTurn*free.monthsStored*free.storagePerGB+free.bytesSentPerTurn*free.egressPerGB)/1e9;
console.log(JSON.stringify({
  assumptions, referenceUSDPerMillionTokens:defaultModelPrice, costsAreIllustrative:true,
  scenarios:sizes.map(n => estimate(n,assumptions,defaultModelPrice)),
  allFreeMonthlyCapacity:[50,100,500].map(budget => ({ budget, users:Math.max(0,Math.floor((budget-free.computeBase-free.databaseBase)/freeMarginal)) })),
  stressBeforeCircuitBreakers:sizes.map(n => estimate(n,{ ...assumptions, payingShare:0, managedShare:1, tokensIn:10000, tokensOut:1000 },{ input:1,output:4 }))
},null,2));
