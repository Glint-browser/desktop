// Native macOS helper for Glint: catches the extra mouse buttons (X1/X2) that
// Chromium ignores on macOS and reports them to JS as "back" / "forward".
//
// It uses a *local* NSEvent monitor, which only observes events already being
// delivered to this app while it's frontmost. That means it needs no
// Accessibility permission and never affects other apps.
//
// Written against the raw Node-API C interface (not node-addon-api) so the
// build has no extra include dirs — important because the project path can
// contain spaces, which breaks node-gyp's -I flags.
#include <node_api.h>
#import <AppKit/AppKit.h>

// Held for the lifetime of the monitor so ARC keeps the objects alive.
static id gMonitor = nil;
static napi_threadsafe_function gTsfn = NULL;
static bool gRunning = false;

// Runs on the JS thread: hand the direction string to the JS callback.
static void CallJs(napi_env env, napi_value js_cb, void* context, void* data) {
  if (env == NULL || js_cb == NULL) return;
  const char* dir = (const char*)data;  // static string literal
  napi_value undefined, arg;
  napi_get_undefined(env, &undefined);
  napi_create_string_utf8(env, dir, NAPI_AUTO_LENGTH, &arg);
  napi_call_function(env, undefined, js_cb, 1, &arg, NULL);
}

// start(callback): begin monitoring. callback is invoked with "back"/"forward".
static napi_value Start(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 1) {
    napi_throw_type_error(env, NULL, "start(callback) requires a function");
    return NULL;
  }
  if (gRunning) return NULL;

  napi_value resource_name;
  napi_create_string_utf8(env, "glint-mouse-nav", NAPI_AUTO_LENGTH, &resource_name);
  napi_create_threadsafe_function(env, argv[0], NULL, resource_name, 0, 1, NULL,
                                  NULL, NULL, CallJs, &gTsfn);
  gRunning = true;

  // NSEventMaskOtherMouseDown covers buttons beyond left/right. buttonNumber 3
  // is the first extra button (Back), 4 is the second (Forward).
  gMonitor = [NSEvent
      addLocalMonitorForEventsMatchingMask:NSEventMaskOtherMouseDown
      handler:^NSEvent *(NSEvent *e) {
        NSInteger button = [e buttonNumber];
        void* data = NULL;
        if (button == 3) data = (void*)"back";
        else if (button == 4) data = (void*)"forward";
        if (data != NULL) {
          napi_call_threadsafe_function(gTsfn, data, napi_tsfn_nonblocking);
          return nil;  // consume so nothing else reacts to it
        }
        return e;  // pass through any other extra buttons untouched
      }];

  return NULL;
}

// stop(): tear down the monitor.
static napi_value Stop(napi_env env, napi_callback_info info) {
  if (gMonitor != nil) {
    [NSEvent removeMonitor:gMonitor];
    gMonitor = nil;
  }
  if (gRunning) {
    napi_release_threadsafe_function(gTsfn, napi_tsfn_release);
    gTsfn = NULL;
    gRunning = false;
  }
  return NULL;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value startFn, stopFn;
  napi_create_function(env, "start", NAPI_AUTO_LENGTH, Start, NULL, &startFn);
  napi_create_function(env, "stop", NAPI_AUTO_LENGTH, Stop, NULL, &stopFn);
  napi_set_named_property(env, exports, "start", startFn);
  napi_set_named_property(env, exports, "stop", stopFn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
