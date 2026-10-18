import { useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { CheckoutElementsProvider, ExpressCheckoutElement, useCheckoutElements } from "@stripe/react-stripe-js/checkout";

export default function LinkCheckout({ clientSecret, publishableKey }: { clientSecret: string; publishableKey: string }) {
  const stripe = useMemo(() => loadStripe(publishableKey), [publishableKey]);
  return <CheckoutElementsProvider stripe={stripe} options={{ clientSecret }}><LinkButton /></CheckoutElementsProvider>;
}

function LinkButton() {
  const state = useCheckoutElements();
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  if (state.type === "loading") return <p className="text-sm text-muted-foreground">Loading Link…</p>;
  if (state.type === "error") return <p role="alert" className="text-sm text-destructive">{state.error.message}</p>;
  return <div className="min-h-12">
    <ExpressCheckoutElement options={{ buttonHeight: 48, buttonTheme: {}, buttonType: {}, paymentMethodOrder: ["link"], paymentMethods: { link: "auto", applePay: "never", googlePay: "never", amazonPay: "never", paypal: "never", klarna: "never" }, layout: { maxColumns: 1, maxRows: 1 } }}
      onReady={(event) => setAvailable(!!event.availablePaymentMethods?.link)}
      onConfirm={async (event) => { setError(null); const result = await state.checkout.confirm({ expressCheckoutConfirmEvent: event }); if (result.type === "error") setError(result.error.message); }} />
    {available === false && <p className="text-sm text-muted-foreground">Link isn’t available here. Use standard checkout instead.</p>}
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
  </div>;
}