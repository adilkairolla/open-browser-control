import { NATIVE_HOST_NAME } from "@obc/shared";
import browser from "webextension-polyfill";

browser.runtime.onInstalled.addListener(() => {
  console.log(`[OBC] extension installed; native host = ${NATIVE_HOST_NAME}`);
});

// TODO: open the native-messaging port with
// `browser.runtime.connectNative(NATIVE_HOST_NAME)` and bridge requests/responses
// between the page and the MCP server. Transport is not wired in this skeleton.
