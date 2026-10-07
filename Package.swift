// swift-tools-version:5.7
//
// Swift Package Manager needs a manifest at the root of the repository it clones, because a
// remote dependency cannot point at a subdirectory. The Swift sources stay in sdks/swift, and
// this manifest is what a consumer resolves. The nested sdks/swift/Package.swift is kept so
// that building inside that directory still works.
//
// Version resolution matters here: SPM derives the package version from the tags on this
// repository, and it only recognises plain semver, stripping a leading lowercase "v". The
// per-SDK tags every other SDK uses (<sdk>-vX.Y.Z) are invisible to it, so a Swift release must
// also carry a bare vX.Y.Z tag. Packagist reads the same bare tags for the PHP package, so Swift
// and PHP share one version line and each release of either needs a version nobody has used.
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
        .library(name: "DoowTrack", targets: ["DoowTrack"])
    ],
    targets: [
        .target(
            name: "DoowTrack",
            path: "sdks/swift/Sources/DoowTrack"
        ),
        .testTarget(
            name: "DoowTrackTests",
            dependencies: ["DoowTrack"],
            path: "sdks/swift/Tests/DoowTrackTests"
        )
    ]
)
