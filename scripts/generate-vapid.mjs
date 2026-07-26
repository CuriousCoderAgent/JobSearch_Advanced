import webpush from "web-push";
const keys = webpush.generateVAPIDKeys();
console.log("\nAdd these to your Vercel environment variables:\n");
console.log("NEXT_PUBLIC_VAPID_PUBLIC_KEY=" + keys.publicKey);
console.log("VAPID_PRIVATE_KEY=" + keys.privateKey);
console.log("");
