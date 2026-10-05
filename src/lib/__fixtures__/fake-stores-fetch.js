// One fetch() stand-in for tests that mix platforms: hosts listed under
// `fourthwall` are served by fakeFourthwallFetch, everything else by
// fakeShopifyFetch. `calls` holds every request either one saw.
import { fakeFourthwallFetch } from "./fake-fourthwall-fetch";
import { fakeShopifyFetch } from "./fake-shopify-fetch";

export function fakeStoresFetch({ shopify = {}, fourthwall = {} }, override, options) {
  const shopifyFetch = fakeShopifyFetch(shopify, override, options);
  const fourthwallFetch = fakeFourthwallFetch(fourthwall, override, options);
  const calls = [];
  const fetchMock = (input, init) => {
    const url = new URL(String(input));
    calls.push(url);
    return (url.host in fourthwall ? fourthwallFetch : shopifyFetch)(input, init);
  };
  fetchMock.calls = calls;
  return fetchMock;
}
