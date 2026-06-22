Pod::Spec.new do |s|
  s.name           = 'RtmpPublisher'
  s.version        = '0.1.0'
  s.summary        = 'Native RTMP publisher (HaishinKit) for LIVE SPOtCH'
  s.description    = 'Pushes camera+mic over RTMP (TCP/buffered) for stable high-quality 4G broadcasting into a LiveKit Ingress.'
  s.author         = 'LIN-NAH'
  s.homepage       = 'https://live-spotch.com'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.0' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # HaishinKit 2.x は Swift Package Manager 専用（CocoaPods 非対応）。
  # Expo SDK 56 の `spm_dependency` ヘルパで SwiftPM 依存として取り込む。
  # 必要プロダクト: HaishinKit(コア) + RTMPHaishinKit(RTMP セッション)。
  spm_dependency(s,
    url: 'https://github.com/HaishinKit/HaishinKit.swift',
    requirement: { kind: 'upToNextMajorVersion', minimumVersion: '2.2.5' },
    products: ['HaishinKit', 'RTMPHaishinKit']
  )

  # Swift/Objective-C compatibility flags（Expo モジュール標準）
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
