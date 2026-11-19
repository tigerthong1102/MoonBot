param([Parameter(Mandatory=$true)][string]$JobFile, [Parameter(Mandatory=$true)][string]$OutFile)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local-path.ps1')
. (Join-Path $PSScriptRoot 'tables.ps1')

function Money($cell, $separator) {
    $text = [string]$cell.text
    if (!$cell.numeric -and $separator -eq ',') {
        if ($text.Contains('.')) { Stop-Audit 'DECIMAL_SEPARATOR' }
        $text = $text.Replace(',', '.')
    }
    if ($text -cnotmatch '^-?[0-9]{1,18}(\.[0-9]{1,6})?$') { Stop-Audit 'INVALID_AMOUNT' }
    if ($cell.numeric -and ($text -replace '[.\-]', '').TrimStart('0').Length -gt 15) { Stop-Audit 'EXCEL_PRECISION' }
    return [decimal]::Parse($text,[Globalization.CultureInfo]::InvariantCulture)
}
function ExactText($cell) {
    if (!$cell -or $cell.numeric -or [string]::IsNullOrWhiteSpace($cell.text)) { Stop-Audit 'EXPECTED_TEXT' }
    return [string]$cell.text
}
function Fmt([decimal]$value) { $value.ToString([Globalization.CultureInfo]::InvariantCulture) }

function Measure-Source($source, $job, $table) {
    $map = @{}
    foreach ($p in $source.fields.PSObject.Properties) {
        if ($table.headers -cnotcontains $p.Value) { Stop-Audit 'FIELD_NOT_FOUND' }
        $map[$p.Name] = $p.Value
    }
    if ($map.psbase.Values.Count -ne @($map.psbase.Values | Sort-Object -Unique).Count) { Stop-Audit 'AMBIGUOUS_MAPPING' }
    $bound=@{}
    foreach ($p in $source.bind.PSObject.Properties) {
        if ($map.ContainsKey($p.Name) -or !$source.evidence -or $source.sha256 -cne $table.sha256 -or
            $job.scope.PSObject.Properties.Name -notcontains $p.Name -or ![string]::Equals($p.Value,$job.scope.($p.Name),[StringComparison]::Ordinal)) { Stop-Audit 'INVALID_SCOPE_BINDING' }
        $bound[$p.Name]=$p.Value
    }
    foreach ($name in @($job.compareFields) + @($job.select) + @($job.keyFields)) {
        if ($name -and !$map.ContainsKey($name)) { Stop-Audit 'FIELD_NOT_FOUND' }
    }
    $scope = @($job.scope.PSObject.Properties)
    foreach ($field in @('company','period','key') + @($scope.Name)) {
        if (!$map.ContainsKey($field) -and !$bound.ContainsKey($field)) { Stop-Audit 'SCOPE_OR_KEY_MISSING' }
    }
    if ($job.op -ne 'find' -and !$map.amount) { Stop-Audit 'AMOUNT_MISSING' }
    if ($source.decimalSeparator -and $source.decimalSeparator -notin @(',','.')) { Stop-Audit 'DECIMAL_SEPARATOR' }
    foreach ($test in @($job.where | Where-Object { $_ })) {
        if (!$map.ContainsKey($test.field) -or $test.op -notin @('equals','contains','above','below')) { Stop-Audit 'FILTER' }
    }
    $groups = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
    $hits = [Collections.Generic.List[object]]::new()
    $inScope = 0; $selected = 0; $total = [decimal]0
    foreach ($row in $table.rows) {
        $ok = $true
        foreach ($p in $scope) {
            if ($bound.ContainsKey($p.Name)) { continue }
            $cell=$row.cells[$map[$p.Name]]
            if ($p.Name -eq 'period' -and $source.periodFormat) {
                if ($source.periodFormat -eq 'excel-date' -and $cell.numeric -and $cell.text -match '^\d{1,6}$') {
                    $serial=[int]$cell.text
                    if (!$table.epoch1904 -and $serial -le 60) { Stop-Audit 'EXCEL_DATE' }
                    $base=if ($table.epoch1904) { [datetime]'1904-01-01' } else { [datetime]'1899-12-30' }
                    $dt=$base.AddDays($serial)
                } elseif ($source.periodFormat -in @('dd/MM/yyyy','yyyy-MM-dd')) {
                    $dt=[datetime]::ParseExact((ExactText $cell),$source.periodFormat,[Globalization.CultureInfo]::InvariantCulture)
                } else { Stop-Audit 'PERIOD_FORMAT' }
                $v=$dt.ToString('yyyy-MM',[Globalization.CultureInfo]::InvariantCulture)
            } else { $v = ExactText $cell }
            if (![string]::Equals($v,[string]$p.Value,[StringComparison]::Ordinal)) { $ok = $false; break }
        }
        if (!$ok) { continue }
        $inScope++
        foreach ($test in @($job.where | Where-Object { $_ })) {
            $cell = $row.cells[$map[$test.field]]
            if (!$cell) { Stop-Audit 'FILTER_CELL_MISSING' }
            switch ($test.op) {
                'equals' { $ok = [string]::Equals((ExactText $cell),[string]$test.value,[StringComparison]::Ordinal) }
                'contains' { $ok = (ExactText $cell).IndexOf([string]$test.value,[StringComparison]::OrdinalIgnoreCase) -ge 0 }
                'above' { $ok = (Money $cell $source.decimalSeparator) -gt (Money @{text=$test.value} '.') }
                'below' { $ok = (Money $cell $source.decimalSeparator) -lt (Money @{text=$test.value} '.') }
            }
            if (!$ok) { break }
        }
        if (!$ok) { continue }
        $selected++
        $key = ExactText $row.cells[$map.key]
        if ($job.keyFields) {
            $parts = @($key) + @(foreach ($field in $job.keyFields) { ExactText $row.cells[$map[$field]] })
            $key = ConvertTo-Json -InputObject $parts -Compress
        }
        if ($job.op -eq 'find') {
            $values = [ordered]@{}
            foreach ($name in $job.select) {
                if (!$map.ContainsKey($name)) { Stop-Audit 'FIELD_NOT_FOUND' }
                $values[$name] = $row.cells[$map[$name]].text
            }
            $hits.Add(@{row=$row.line; key=$key; fields=$values})
        } else {
            $amount = Money $row.cells[$map.amount] $source.decimalSeparator
            $total += $amount
            if (!$groups.ContainsKey($key)) {
                $fields=@{}
                foreach ($name in $job.compareFields) { $fields[$name]=ExactText $row.cells[$map[$name]] }
                $groups.Add($key,@{count=0; total=[decimal]0; fields=$fields; rows=[Collections.Generic.List[int]]::new()})
            }
            $g = $groups[$key]; $g.count++; $g.total += $amount; $g.rows.Add($row.line)
        }
    }
    return @{groups=$groups; hits=$hits; summary=@{sourceRows=$table.rows.Count; scopedRows=$inScope; selectedRows=$selected; sha256=$table.sha256; mappedFields=$source.fields; binding=$source.bind; bindingEvidence=$source.evidence; periodFormat=$source.periodFormat; sheet=$source.sheet; headerRow=$source.headerRow; lastRow=$source.lastRow; recordPath=$source.recordPath; namespace=$source.namespace; decimalSeparator=$source.decimalSeparator; total=if ($job.op -ne 'find') { Fmt $total } else { $null } }}
}

try {
    $JobFile = Get-AuditLocalPath $JobFile
    $OutFile = Get-AuditLocalPath $OutFile
    if ((Get-Item -LiteralPath $JobFile).Length -gt 65536) { Stop-Audit 'JOB_SIZE' }
    $job = [IO.File]::ReadAllText($JobFile) | ConvertFrom-Json
    if ($job.op -notin @('inspect','find','total','compare')) { Stop-Audit 'OPERATION' }
    $left = Read-AuditTable $job.left
    $report = [ordered]@{version='0.1.1'; generatedUtc=[DateTime]::UtcNow.ToString('o'); operation=$job.op}
    if ($job.op -ne 'inspect' -and ($left.metadataOnly -or ($job.op -eq 'compare' -and !$job.right))) { Stop-Audit 'SOURCE_SELECTION' }
    if ($job.op -eq 'inspect' -and $left.metadataOnly) {
        $report.source=$left
    } elseif ($job.op -eq 'inspect') {
        $report.source = @{sha256=$left.sha256; rows=$left.rows.Count; headers=$left.headers; sheet=$left.sheet; recordPath=$left.recordPath}
    } else {
        if (!$job.scope.company -or !$job.scope.period) { Stop-Audit 'SCOPE_MISSING' }
        $report.scope=$job.scope; $report.filters=$job.where; $report.keyFields=@('key')+@($job.keyFields | Where-Object { $_ }); $report.compareFields=$job.compareFields
        $a = Measure-Source $job.left $job $left
        $report.left = $a.summary
        if ($job.op -eq 'find') { $report.matches=$a.hits }
        if ($job.op -eq 'compare') {
            $right = Read-AuditTable $job.right
            if ($right.metadataOnly) { Stop-Audit 'SOURCE_SELECTION' }
            $b = Measure-Source $job.right $job $right
            $report.right=$b.summary
            $keys=[Collections.Generic.SortedSet[string]]::new([StringComparer]::Ordinal)
            foreach ($key in $a.groups.psbase.Keys) { [void]$keys.Add($key) }
            foreach ($key in $b.groups.psbase.Keys) { [void]$keys.Add($key) }
            $exceptions=[Collections.Generic.List[object]]::new(); $matched=0
            foreach ($key in $keys) {
                $x=$a.groups[$key]; $y=$b.groups[$key]
                $status = if (!$x) { 'only_right' } elseif (!$y) { 'only_left' } elseif ($x.total -ne $y.total) { 'amount_difference' } elseif ($x.count -ne 1 -or $y.count -ne 1) { 'review_grain' } else { 'matched' }
                $different = @(if ($x -and $y -and $x.count -eq 1 -and $y.count -eq 1) {
                    foreach ($field in $job.compareFields) {
                        if (![string]::Equals($x.fields[$field],$y.fields[$field],[StringComparison]::Ordinal)) { $field }
                    }
                })
                if ($status -eq 'matched' -and $different.Count) { $status='field_difference' }
                if ($status -eq 'matched') { $matched++; continue }
                $exceptions.Add(@{key=$key; status=$status; differentFields=$different; leftRows=$x.rows; rightRows=$y.rows; leftAmount=if($x){Fmt $x.total}else{$null}; rightAmount=if($y){Fmt $y.total}else{$null}; difference=if($x -and $y){Fmt ($x.total-$y.total)}else{$null}})
            }
            $report.matched=$matched; $report.exceptions=$exceptions; $report.keys=$keys.Count
        }
    }
    $json = if ([IO.Path]::GetExtension($OutFile) -eq '.html') {
        . (Join-Path $PSScriptRoot 'report.ps1')
        Format-AuditReport $report
    } else { ConvertTo-Json -InputObject $report -Depth 10 }
    $out=[IO.File]::Open([IO.Path]::GetFullPath($OutFile),'CreateNew','Write','None')
    try { $bytes=[Text.UTF8Encoding]::new($false).GetBytes($json); $out.Write($bytes,0,$bytes.Length) } finally { $out.Dispose() }
    $summary=[ordered]@{status='AUDIT_REPORT_CREATED'; operation=$job.op}
    if ($job.op -ne 'inspect') { $summary.selected=$a.summary.selectedRows }
    if ($job.op -eq 'compare') { $summary.matched=$matched; $summary.exceptions=$exceptions.Count }
    Write-Output (ConvertTo-Json $summary -Compress)
} catch {
    $msg=$_.Exception.Message
    if ($msg -notmatch '^AUDIT_[A-Z_]+$') { $msg='AUDIT_INPUT_OR_OUTPUT_ERROR' }
    [Console]::Error.WriteLine($msg)
    exit 1
}
