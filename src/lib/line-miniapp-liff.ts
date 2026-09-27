"use client";
import liff from "@line/liff/core";
import Login from "@line/liff/login";
import IsLoggedIn from "@line/liff/is-logged-in";
import GetIDToken from "@line/liff/get-id-token";

// Load only login APIs; no analytics, profile collection or messaging plugins.
liff.use(new Login()).use(new IsLoggedIn()).use(new GetIDToken());
export default liff;
