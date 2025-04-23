module.exports = {
    "extends": "eslint:recommended",
    "globals": {
      "Utils" : "writable", // defined in utils.js
      "UART" : "readonly",
      "Puck" : "readonly",
      "device" : "writable", // defined in index.js
      "appJSON" : "writable", // defined in index.js

    },
    "rules": {
        "indent": [
            "off",
            2,
            {
                "SwitchCase": 1
            }
        ],
        "no-constant-condition": "off",
        "no-empty": ["warn", { "allowEmptyCatch": true }],
        "no-global-assign": "off",
        "no-inner-declarations": "off",
        "no-prototype-builtins": "off",
        "no-redeclare": "off",
        "no-unreachable": "warn",
        "no-cond-assign": "warn",
        "no-useless-catch": "warn",
        "no-undef": "warn",
        "no-unused-vars": ["warn", { "args": "none" } ],
        "no-useless-escape": "off",
        "no-control-regex" : "off"
    },
     reportUnusedDisableDirectives: true,
}
