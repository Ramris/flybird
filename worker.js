
import { parse, stringify } from "yaml";

const UPSTREAM_API =
  "https://cggac.908970.xyz/api/v1/client/subscribe";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // 1. 请求方法检查
    // =========================

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { "Allow": "GET, HEAD" }
      });
    }

    // =========================
    // 2. 从访问路径提取上游 Token
    // =========================

    const pathParts = url.pathname.split("/");

    if (
      pathParts.length !== 3 ||
      pathParts[1] !== "sub" ||
      !pathParts[2]
    ) {
      return new Response("Not Found", { status: 404 });
    }

    let token;

    try {
      token = decodeURIComponent(pathParts[2]);
    } catch {
      return new Response("Invalid Token", { status: 400 });
    }

    // 限制 Token 格式，避免异常输入
    if (!/^[a-zA-Z0-9._~-]{16,256}$/.test(token)) {
      return new Response("Invalid Token", { status: 400 });
    }

    try {
      // =========================
      // 3. 请求上游订阅
      // =========================

      const upstreamUrl = new URL(UPSTREAM_API);
      upstreamUrl.searchParams.set("token", token);

      const upstream = await fetch(upstreamUrl.toString(), {
        method: "GET",
        headers: {
          "User-Agent":
            env.UPSTREAM_UA || "clash-verge/v2.4.6",
          "Accept": "*/*"
        },
        redirect: "manual"
      });

      if (!upstream.ok) {
        console.error("Upstream HTTP:", upstream.status);

        return new Response("Upstream subscription error", {
          status: 502
        });
      }

      // =========================
      // 4. 解析 YAML
      // =========================

      const source = await upstream.text();
      const config = parse(source);

      if (
        !config ||
        typeof config !== "object" ||
        Array.isArray(config)
      ) {
        throw new Error("Invalid YAML configuration");
      }

      const proxies = Array.isArray(config.proxies)
        ? config.proxies
        : [];

      const oldGroups = Array.isArray(config["proxy-groups"])
        ? config["proxy-groups"]
        : [];

      // =========================
      // 5. 清洗节点名称
      // =========================

      function cleanName(name) {
        return String(name || "")
          .replace(/[^\u4e00-\u9fff]/g, "") || "未分类";
      }

      // =========================
      // 6. 根据名称分组
      // =========================

      const groups = new Map();

      for (const proxy of proxies) {
        const originalName = proxy.name || "未命名";
        const groupName = cleanName(originalName);

        if (!groups.has(groupName)) {
          groups.set(groupName, []);
        }

        groups.get(groupName).push(originalName);
      }

      // =========================
      // 7. 生成新策略组
      // =========================

      let masterName = "节点选择";

      while (groups.has(masterName)) {
        masterName += "总";
      }

      const groupNames = [...groups.keys()].sort();

      const newGroups = [];

      // 总策略组
      newGroups.push({
        name: masterName,
        type: "select",
        proxies: [...groupNames, "DIRECT"]
      });

      // 每个节点名称对应一个策略组
      for (const groupName of groupNames) {
        newGroups.push({
          name: groupName,
          type: "select",
          proxies: groups.get(groupName)
        });
      }

      // =========================
      // 8. 替换规则中的旧策略组引用
      // =========================

      const oldGroupNames = new Set(
        oldGroups
          .map(group => group?.name)
          .filter(Boolean)
      );

           
function updateRule(rule) {
  if (typeof rule !== "string") {
    return rule;
  }

  const parts = rule.split(",");

  if (parts.length < 2) {
    return rule;
  }

  const ruleType = parts[0].trim().toUpperCase();

  // MATCH / FINAL 规则只有一个策略组字段
  // 其他常规规则的策略组字段位于第三列
  let policyIndex;

  if (["MATCH", "FINAL"].includes(ruleType)) {
    policyIndex = 1;
  } else {
    policyIndex = 2;
  }

  if (policyIndex >= parts.length) {
    return rule;
  }

  const oldPolicy = parts[policyIndex].trim();

  // 如果引用了旧策略组，则替换成新总策略组
  if (oldGroupNames.has(oldPolicy)) {
    parts[policyIndex] = masterName;
  }

  return parts.join(",");
}


      if (Array.isArray(config.rules)) {
        config.rules = config.rules.map(updateRule);
      }

      // =========================
      // 9. 替换原有策略组
      // =========================

      config["proxy-groups"] = newGroups;

      // =========================
      // 10. 生成完整 YAML
      // =========================

      const output = stringify(config, {
        lineWidth: 0
      });

      // =========================
      // 11. 返回订阅
      // =========================

      const responseHeaders = new Headers({
        "Content-Type": "text/yaml; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="飞鸟云"',
        "Cache-Control": "no-store",
        "profile-update-interval":
          upstream.headers.get("profile-update-interval") || "24"
      });

      // 保留机场流量信息
      const metadataHeaders = [
        "subscription-userinfo",
        "profile-web-page-url",
        "support-url"
      ];

      for (const name of metadataHeaders) {
        const value = upstream.headers.get(name);

        if (value) {
          responseHeaders.set(name, value);
        }
      }

      return new Response(
        request.method === "HEAD" ? null : output,
        {
          status: 200,
          headers: responseHeaders
        }
      );

    } catch (error) {
      console.error(
        "Subscription conversion failed:",
        error.message
      );

      return new Response(
        "Subscription conversion failed",
        { status: 502 }
      );
    }
  }
};