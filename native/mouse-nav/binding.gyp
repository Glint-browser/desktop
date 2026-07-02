{
  "targets": [
    {
      "target_name": "mouse_nav",
      "defines": ["NAPI_VERSION=8"],
      "conditions": [
        ["OS=='mac'", {
          "sources": ["mouse_nav.mm"],
          "libraries": ["-framework AppKit"],
          "xcode_settings": {
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "MACOSX_DEPLOYMENT_TARGET": "10.15"
          }
        }],
        ["OS!='mac'", {
          "sources": ["stub.cc"]
        }]
      ]
    }
  ]
}
