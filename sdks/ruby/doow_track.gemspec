Gem::Specification.new do |spec|
  spec.name          = "doow_track"
  spec.version       = "0.1.0"
  spec.authors       = ["Doow"]
  spec.email         = ["dev@doow.co"]

  spec.summary       = "Official Ruby SDK for Doow usage telemetry and management"
  spec.description   = "Track usage events and manage apps, contracts, licenses, and metrics with the Doow API"
  spec.homepage      = "https://github.com/Doow-Dev/doow-track-ruby"
  spec.license       = "MIT"
  spec.required_ruby_version = ">= 3.0.0"

  spec.metadata["homepage_uri"] = spec.homepage
  spec.metadata["source_code_uri"] = spec.homepage
  spec.metadata["changelog_uri"] = "#{spec.homepage}/blob/main/CHANGELOG.md"

  spec.files = Dir["lib/**/*", "LICENSE", "README.md"]
  spec.require_paths = ["lib"]

  spec.add_dependency "json", "~> 2.0"
  spec.add_dependency "net-http", "~> 0.3"

  spec.add_development_dependency "rspec", "~> 3.12"
  spec.add_development_dependency "webmock", "~> 3.18"
end
