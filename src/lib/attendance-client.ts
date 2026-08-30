export function collectBestPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("此瀏覽器不支援定位。"));
      return;
    }
    const samples: GeolocationPosition[] = [];
    let watchId = -1;
    const finish = () => {
      if (watchId >= 0) navigator.geolocation.clearWatch(watchId);
      window.clearTimeout(timer);
      const best = [...samples].sort((a, b) => a.coords.accuracy - b.coords.accuracy)[0];
      if (best) resolve(best);
      else reject(new Error("無法取得定位，請確認 GPS 與網站定位權限。"));
    };
    const timer = window.setTimeout(finish, 12_000);
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        samples.push(position);
        if (samples.length >= 3 || position.coords.accuracy <= 20) finish();
      },
      (error) => {
        if (watchId >= 0) navigator.geolocation.clearWatch(watchId);
        window.clearTimeout(timer);
        reject(new Error(
          error.code === error.PERMISSION_DENIED
            ? "定位權限被拒絕，請在瀏覽器網站設定中允許定位。"
            : error.code === error.TIMEOUT
              ? "定位逾時，請移至窗邊或空曠處後再試。"
              : "無法取得定位，請確認 GPS 與網路後再試。",
        ));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
    );
  });
}

export function attendanceRiskLabel(code: string) {
  return ({
    LOCATION_STALE: "定位資料過期",
    LOCATION_FUTURE: "定位時間異常",
    ACCURACY_TOO_POOR: "定位精度不足",
    OUTSIDE_GEOFENCE: "超出打卡範圍",
    GEOFENCE_BOUNDARY: "位於範圍邊界",
    ROTATING_CODE_INVALID: "動態驗證碼不正確",
    DEVICE_NOT_BOUND: "裝置登入綁定失效",
    IMPOSSIBLE_TRAVEL: "位置跳躍異常",
    HIGH_TRAVEL_SPEED: "移動速度異常",
    LATE_CLOCK_IN: "遲到打卡，等待主管覆核",
    EARLY_CLOCK_OUT: "早退打卡，等待主管覆核",
    ALREADY_CLOCKED_IN: "已是上班狀態",
    NOT_CLOCKED_IN: "尚未上班打卡",
  } as Record<string, string>)[code] ?? code;
}
