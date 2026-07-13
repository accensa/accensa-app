import express from "express";
import { 
  paymentMiddlewareFromHTTPServer, 
  x402ResourceServer, 
  x402HTTPResourceServer 
} from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import fs from "fs";

const app = express();
const PORT = 3001;

// 1. Create the resource server and point it to the public facilitator
const resourceServer = new x402ResourceServer([
  new HTTPFacilitatorClient({ url: "https://www.x402.org/facilitator" })
]);

// 2. This is the crucial Path B Hook! We intercept the settlement response here.
resourceServer.onAfterSettle(async (ctx) => {
  if (ctx.result.success) {
    console.log("✅ Settlement successful!");
    console.log("Transaction Hash:", ctx.result.transaction);
    console.log("Payer:", ctx.result.payer);
    console.log("Amount:", ctx.result.amount);
    
    // Save the raw context to a file so we have our ground-truth data for the indexer
    const payload = {
      path: ctx.paymentPayload?.path,
      transaction: ctx.result.transaction,
      payer: ctx.result.payer,
      amount: ctx.result.amount,
      network: ctx.result.network,
      rawResult: ctx.result,
      paymentPayload: ctx.paymentPayload
    };
    
    fs.writeFileSync("settle_payload.json", JSON.stringify(payload, null, 2));
    console.log("💾 Captured payload to settle_payload.json");
  } else {
    console.error("❌ Settlement failed:", ctx.result.errorReason);
  }
});

// 3. Configure the routes
const routesConfig = {
  "/api/hello": {
    accepts: {
      scheme: "exact",
      price: "1000", // e.g. 1000 stroops
      network: "stellar:testnet",
      payTo: process.env.MERCHANT_ADDRESS || "GAQW...REPLACE_WITH_REAL_ADDRESS",
    },
  },
};

const httpServer = new x402HTTPResourceServer(resourceServer, routesConfig);

// 4. Apply the middleware
app.use(paymentMiddlewareFromHTTPServer(httpServer));

// 5. Protected route
app.get("/api/hello", (req, res) => {
  res.json({ 
    message: "Payment verified!", 
    data: "This is the premium Accensa content." 
  });
});

app.listen(PORT, () => {
  console.log(`Demo merchant server running on port ${PORT}`);
  console.log(`Protected route: http://localhost:${PORT}/api/hello`);
});
