// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "DoowTrack",
    platforms: [
        .macOS(.v12),
        .iOS(.v15),
        .tvOS(.v15),
        .watchOS(.v8)
    ],
    products: [
        .library(name: "DoowTrack", targets: ["DoowTrack"]),
        .executable(name: "doow-sidecar", targets: ["DoowSidecar"])
    ],
    targets: [
        .target(
            name: "DoowTrack",
            path: "Sources/DoowTrack"
        ),
        .executableTarget(
            name: "DoowSidecar",
            dependencies: ["DoowTrack"],
            path: "Sources/DoowSidecar"
        ),
        .testTarget(
            name: "DoowTrackTests",
            dependencies: ["DoowTrack"],
            path: "Tests/DoowTrackTests"
        )
    ]
)
