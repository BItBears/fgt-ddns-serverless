基于 Vercel 平台的 Serverless 方案，实现通过 **阿里云** (Aliyun) 和 **Cloudflare** 自动更新动态 DNS (DDNS) 记录。

> **免责声明:** 本项目基于他人代码修改。请注意，示例地址不保证稳定性，**强烈建议自行部署在 Vercel 上。**

## 🛠️ 项目部署与调试

1. ### 调试环境搭建
2. **克隆仓库:**

```Plain
git clone https://github.com/BItBears/fgt-ddns-serverless.git
```

1. **安装依赖:**

```Plain
yarn
```

1. **本地运行:**

```Plain
yarn vercel dev
```

2. ### 正式部署

在 [Vercel](https://vercel.com/) 平台上部署此项目，然后配置一个自定义域名即可使用。

## 🌐 服务端点 (API URL)

部署完成后，您可以使用以下 API 端点进行 DDNS 更新：

| 服务提供商      | API URL 示例                                          |
| ----------------- | ------------------------------------------------------- |
| 阿里云 (Aliyun) | https://fgt-ddns-serverless.vercel.app/api/aliyun     |
| Cloudflare      | https://fgt-ddns-serverless.vercel.app/api/cloudflare |

*(注: 请将示例中的域名替换为您实际部署的域名。)*

## ⚙️ DDNS 更新参数说明

在发起更新请求时，需要提供的 URL 查询参数 (Query Parameters) 如下：

| 参数       | 描述                | 阿里云对应                   | Cloudflare 对应              |
| ------------ | --------------------- | ------------------------------ | ------------------------------ |
| identifier | 身份标识 ID         | AccessKey ID                 | 区域 ID (Zone ID)            |
| secret     | 密钥/令牌           | AccessKey Secret             | API Token                    |
| type       | 解析记录类型        | A, CNAME, 等                 | A, CNAME, 等                 |
| name       | 域名前缀 (主机记录) | 例如 www, @, blog            | 例如 www, @, blog            |
| domain     | 顶级域名/主机名     | 例如[demo.com](http://demo.com) | 例如[demo.com](http://demo.com) |
| ip         | 新的 IP 地址        | 待更新的公网 IP              | 待更新的公网 IP              |

## 💻 客户端配置示例

3. ### RouterOS 脚本模板

添加以下脚本到 RouterOS，实现定时或拨号后自动更新 DDNS。

> ⚠️ **重要提醒:** 输入时请务必将中文注释删掉，并替换请求地址和参数。

```Plain
:local identifier "" # 替换为您的 ID
:local secret "" # 替换为您的 Token
:local type "A" # 解析类型，默认为 A
:local name "www" # 域名前缀
:local domain "demo.com" # 主机名

:local pppoe "pppoe-out1" # ‼️ 确定并替换为您的 WAN 口名称
:local UPDATE_DDNS_URL "https://fgt-ddns-serverless.vercel.app/api/aliyun" # ‼️ 替换为您的 API URL

# 获取当前 WAN 口 IP 地址
:local ipaddr [/ip address get [/ip address find interface=$pppoe] address]
:set ipaddr [:pick $ipaddr 0 ([len $ipaddr] -3)]

:global aliip # 用于存储上一次的 IP 地址
:if ($ipaddr != $aliip) do={
    # IP 地址发生变化，执行 DDNS 更新
    :local result [/tool fetch url="$UPDATE_DDNS_URL?identifier=$identifier&secret=$secret&name=$name&type=$type&ip=$ipaddr&domain=$domain" as-value output=user];
    :set aliip $ipaddr
}
```

> **后续操作:** 至于如何设置脚本为定时运行或 WAN 口重新拨号后自动运行，请参考 RouterOS 的文档，此处不再赘述。

4. ### FortiGate 配置示例 (单接口)

> **注意:** 以下命令仅在 **FortiGate 7.0 及以上版本** 测试通过！*(多 WAN 口的 FortiGate 动态 DDNS 方案还在探索中。)*

此配置利用 FortiGate 的自动化功能 (Automation) 在 PPPoE 拨号成功后触发 DDNS 更新。

#### I. 创建触发器 (`Trigger`)

当 PPPoE 拨号成功时（日志 ID `29010`）触发事件。

```Plain
config system automation-trigger
    edit "PPPOE_UP_Trigger"
        set event-type event-log
        set logid 29010
    next
end
```

#### II. 创建操作 (`Action`)

配置 Webhook (DDNS API 请求)。注意，使用 `%%log.assigned%%` 变量来动态获取拨号获得的 IP 地址。

```Plain
config system automation-action
    edit "DDNS_Update_For_Aliyun"
        set action-type webhook
        set minimum-interval 1
        set protocol https
        set uri "fgt-ddns-serverless.vercel.app/api/aliyun" # ‼️ 替换为您的 API URL
        set http-body "{\"identifier\":\"YOUR_ID\",\"secret\":\"YOUR_SECRET\", \"domain\":\"demo.com\", \"name\":\"test\", \"type\":\"A\",\"ip\":\"%%log.assigned%%\"}" # ‼️ 替换您的 ID/密钥/域名
        set port 443
        config http-headers
            edit 1
                set key "Content-Type"
                value "application/json"
            next
        end
        set verify-host-cert disable
    next
end
```

#### III. 创建工作流 (`Stitch`)

将触发器与操作关联起来，设置延迟以确保网络稳定。

```Plain
config system automation-stitch
    edit "PPPoE_DDNS_Stitch"
        set trigger "PPPOE_UP_Trigger"
        config actions
            edit 1
                set action "DDNS_Update_For_Aliyun"
                set delay 20 # 延迟 20 秒执行
                set required enable
            next
        end
    next
end
```

## 🚨 注意事项

请尽量自己部署在 Vercel 上。示例地址不保证稳定性。
