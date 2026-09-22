# frozen_string_literal: true

require "net/http"
require "json"
require "uri"

module DoowTrack
  class Management
    DEFAULT_OPTIONS = {
      endpoint: "https://api.doow.co",
      timeout: 30,
      retry_count: 3,
      debug: false
    }.freeze

    def initialize(api_key, **options)
      @api_key = ENV["DOOW_TRACK_API_KEY"] || api_key
      @options = DEFAULT_OPTIONS.merge(options)
      @options[:endpoint] = ENV["DOOW_TRACK_ENDPOINT"] if ENV["DOOW_TRACK_ENDPOINT"]
      @options[:debug] = true if ENV["DOOW_TRACK_DEBUG"] == "true"

      raise Error, "Invalid API key format. Must start with 'dk_'." unless @api_key&.start_with?("dk_")
    end

    def apps
      AppsResource.new(self)
    end

    def contracts
      ContractsResource.new(self)
    end

    def licenses
      LicensesResource.new(self)
    end

    def metrics
      MetricsResource.new(self)
    end

    def expenses
      ExpensesResource.new(self)
    end

    def request(method, path, body: nil)
      url = URI("#{@options[:endpoint].chomp('/')}/sdk#{path}")
      log("[doow/management] #{method.upcase} #{path}")

      (@options[:retry_count] + 1).times do |attempt|
        begin
          http = Net::HTTP.new(url.host, url.port)
          http.use_ssl = url.scheme == "https"
          http.open_timeout = @options[:timeout]
          http.read_timeout = @options[:timeout]

          request = case method
                    when :get then Net::HTTP::Get.new(url)
                    when :post then Net::HTTP::Post.new(url)
                    when :patch then Net::HTTP::Patch.new(url)
                    when :delete then Net::HTTP::Delete.new(url)
                    end

          request["Authorization"] = "Bearer #{@api_key}"
          request["Content-Type"] = "application/json"
          request.body = body.to_json if body

          response = http.request(request)

          if response.code.to_i >= 200 && response.code.to_i < 300
            return nil if response.body.nil? || response.body.empty?
            return JSON.parse(response.body, symbolize_names: true)
          end

          if response.code.to_i >= 500 && attempt < @options[:retry_count]
            sleep(2**attempt)
            next
          end

          raise Error.new("API error: #{response.body}", status_code: response.code.to_i)
        rescue StandardError => e
          raise if e.is_a?(Error)
          if attempt < @options[:retry_count]
            sleep(2**attempt)
            next
          end
          raise Error.new("Request failed: #{e.message}")
        end
      end
    end

    private

    def log(message)
      $stderr.puts(message) if @options[:debug]
    end
  end

  class AppsResource
    def initialize(mgmt)
      @mgmt = mgmt
    end

    def list(cursor: nil, limit: 50)
      path = "/apps?limit=#{limit}"
      path += "&cursor=#{cursor}" if cursor
      data = @mgmt.request(:get, path)
      parse_paginated(data, App)
    end

    def get(id)
      data = @mgmt.request(:get, "/apps/#{id}")
      App.new(**data)
    end

    def create(name:, **attrs)
      data = @mgmt.request(:post, "/apps", body: { name: name, **attrs })
      App.new(**data)
    end

    def update(id, **attrs)
      data = @mgmt.request(:patch, "/apps/#{id}", body: attrs)
      App.new(**data)
    end

    def delete(id)
      @mgmt.request(:delete, "/apps/#{id}")
    end

    private

    def parse_paginated(data, klass)
      PaginatedResponse.new(
        data: data[:data].map { |d| klass.new(**d) },
        next_cursor: data[:next_cursor],
        has_more: data[:has_more]
      )
    end
  end

  class ContractsResource
    def initialize(mgmt)
      @mgmt = mgmt
    end

    def list_by_app(app_id, cursor: nil, limit: 50)
      path = "/apps/#{app_id}/contracts?limit=#{limit}"
      path += "&cursor=#{cursor}" if cursor
      data = @mgmt.request(:get, path)
      parse_paginated(data)
    end

    def get(id)
      data = @mgmt.request(:get, "/contracts/#{id}")
      parse_contract(data)
    end

    def create(app_id, title:, contract_type: ContractType::PAY_AS_YOU_GO, licenses: [])
      data = @mgmt.request(:post, "/apps/#{app_id}/contracts", body: {
        title: title,
        contract_type: contract_type,
        licenses: licenses
      })
      parse_contract(data)
    end

    def delete(id)
      @mgmt.request(:delete, "/contracts/#{id}")
    end

    private

    def parse_contract(data)
      licenses = (data[:licenses] || []).map { |l| License.new(**l) }
      Contract.new(**data.merge(licenses: licenses))
    end

    def parse_paginated(data)
      PaginatedResponse.new(
        data: data[:data].map { |d| parse_contract(d) },
        next_cursor: data[:next_cursor],
        has_more: data[:has_more]
      )
    end
  end

  class LicensesResource
    def initialize(mgmt)
      @mgmt = mgmt
    end

    def list(cursor: nil, limit: 50)
      path = "/licenses?limit=#{limit}"
      path += "&cursor=#{cursor}" if cursor
      data = @mgmt.request(:get, path)
      PaginatedResponse.new(
        data: data[:data].map { |d| License.new(**d) },
        next_cursor: data[:next_cursor],
        has_more: data[:has_more]
      )
    end

    def get(id)
      data = @mgmt.request(:get, "/licenses/#{id}")
      License.new(**data)
    end
  end

  class MetricsResource
    def initialize(mgmt)
      @mgmt = mgmt
    end

    def list_by_license(license_id, cursor: nil, limit: 50)
      path = "/licenses/#{license_id}/metrics?limit=#{limit}"
      path += "&cursor=#{cursor}" if cursor
      data = @mgmt.request(:get, path)
      PaginatedResponse.new(
        data: data[:data].map { |d| Metric.new(**d) },
        next_cursor: data[:next_cursor],
        has_more: data[:has_more]
      )
    end

    def get(id)
      data = @mgmt.request(:get, "/metrics/#{id}")
      Metric.new(**data)
    end

    def create(license_id, metric_type:, **attrs)
      data = @mgmt.request(:post, "/licenses/#{license_id}/metrics", body: { metric_type: metric_type, **attrs })
      Metric.new(**data)
    end

    def delete(id)
      @mgmt.request(:delete, "/metrics/#{id}")
    end
  end

  class ExpensesResource
    def initialize(mgmt)
      @mgmt = mgmt
    end

    def list_by_app(app_id, cursor: nil, limit: 50)
      path = "/apps/#{app_id}/expenses?limit=#{limit}"
      path += "&cursor=#{cursor}" if cursor
      data = @mgmt.request(:get, path)
      PaginatedResponse.new(
        data: data[:data].map { |d| Expense.new(**d) },
        next_cursor: data[:next_cursor],
        has_more: data[:has_more]
      )
    end
  end
end
