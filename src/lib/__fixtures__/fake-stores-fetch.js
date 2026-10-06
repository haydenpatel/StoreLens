// One fetch() stand-in for tests that mix platforms: hosts listed under
// `fourthwall` are served by fakeFourthwallFetch, `bigcartel` shops (by
// subdomain name, as *.bigcartel.com hosts and api.bigcartel.com requests) by
// fakeBigCartelFetch, everything else by fakeShopifyFetch. `calls` holds every
// request any of them saw.
import { fakeBigCartelFetch, FEED_HOST } from "./fake-bigcartel-fetch";
import { fakeFourthwallFetch } from "./fake-fourthwall-fetch";
import { fakeShopifyFetch } from "./fake-shopify-fetch";

export function fakeStoresFetch({ shopify = {}, fourthwall = {}, bigcartel = {} }, override, options) {
  const shopifyFetch = fakeShopifyFetch(shopify, override, options);
  const fourthwallFetch = fakeFourthwallFetch(fourthwall, override, options);
  const bigcartelFetch = fakeBigCartelFetch(bigcartel, override, options);
  const calls = [];
  const fetchMock = (input, init) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.host in fourthwall) return fourthwallFetch(input, init);
    if (url.host === FEED_HOST || url.host.endsWith(".bigcartel.com")) return bigcartelFetch(input, init);
    return shopifyFetch(input, init);
  };
  fetchMock.calls = calls;
  return fetchMock;
}
