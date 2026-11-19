param([Parameter(Mandatory=$true)][string]$Profile,
      [Parameter(Mandatory=$true)][string]$Month,
      [Parameter(Mandatory=$true)][string]$OutFile)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'local-path.ps1')
$conn=$null; $reader=$null; $out=$null; $writer=$null
$created=$false; $complete=$false
try {
    $Profile = Get-AuditLocalPath $Profile
    $OutFile = Get-AuditLocalPath $OutFile
    $p=[IO.File]::ReadAllText($Profile) | ConvertFrom-Json
    if ($p.instance -cnotmatch '^[A-Za-z][A-Za-z0-9_]{0,15}$' -or !$p.database -or !$p.company -or !$p.reader -or
        $Month -cnotmatch '^\d{4}-(0[1-9]|1[0-2])$') { throw 'AUDIT_PROFILE' }
    $branch=[Guid]::Parse($p.branch)
    $start=[DateTime]::ParseExact($Month+'-01','yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
    $builder=[Data.SqlClient.SqlConnectionStringBuilder]::new()
    $builder['Data Source']='lpc:.\'+$p.instance
    $builder['Initial Catalog']=[string]$p.database
    $builder['Integrated Security']=$true
    $builder['Pooling']=$false
    $builder['Connect Timeout']=6
    $builder['Application Name']='StartupBot Audit'
    $conn=[Data.SqlClient.SqlConnection]::new($builder.ConnectionString)
    $conn.Open()
    $cmd=$conn.CreateCommand()
    $cmd.CommandTimeout=10
    $cmd.CommandText=@'
SELECT CASE WHEN
    CONVERT(varchar(10),SERVERPROPERTY('ProductMajorVersion'))='15'
    AND CONNECTIONPROPERTY('net_transport')='Shared memory'
    AND ORIGINAL_LOGIN()=@reader AND DB_NAME()=@database AND USER_NAME()<>'dbo'
    AND NOT EXISTS (SELECT 1 FROM sys.fn_my_permissions(NULL,'SERVER')
                    WHERE permission_name NOT IN ('CONNECT SQL','VIEW ANY DATABASE'))
    AND NOT EXISTS (SELECT 1 FROM sys.fn_my_permissions(NULL,'DATABASE')
                    WHERE permission_name NOT IN ('CONNECT','SELECT','VIEW DEFINITION',
                      'VIEW ANY COLUMN ENCRYPTION KEY DEFINITION','VIEW ANY COLUMN MASTER KEY DEFINITION'))
    AND NOT EXISTS (SELECT 1 FROM sys.fn_my_permissions('dbo.SAVoucher','OBJECT')
                    WHERE permission_name NOT IN ('SELECT','VIEW DEFINITION'))
    AND NOT EXISTS (SELECT 1 FROM sys.fn_my_permissions('dbo.SAVoucherDetail','OBJECT')
                    WHERE permission_name NOT IN ('SELECT','VIEW DEFINITION'))
    AND HAS_PERMS_BY_NAME('dbo.SAVoucher','OBJECT','SELECT')=1
    AND HAS_PERMS_BY_NAME('dbo.SAVoucherDetail','OBJECT','SELECT')=1
    AND EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.SAVoucher') AND name='TotalSaleAmount'
                AND TYPE_NAME(system_type_id) IN ('decimal','numeric') AND precision=18 AND scale=4)
    AND EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.SAVoucherDetail') AND name='Amount'
                AND TYPE_NAME(system_type_id) IN ('decimal','numeric') AND precision=18 AND scale=4)
THEN 1 ELSE 0 END
'@
    [void]$cmd.Parameters.Add('@reader',[Data.SqlDbType]::NVarChar,128)
    $cmd.Parameters['@reader'].Value=[string]$p.reader
    [void]$cmd.Parameters.Add('@database',[Data.SqlDbType]::NVarChar,128)
    $cmd.Parameters['@database'].Value=[string]$p.database
    if ($cmd.ExecuteScalar() -ne 1) { throw 'AUDIT_SOURCE_OR_RIGHTS_UNVERIFIED' }
    $cmd.Parameters.Clear()
    $cmd.CommandText=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'monthly-sales.sql'))
    [void]$cmd.Parameters.Add('@branch',[Data.SqlDbType]::UniqueIdentifier)
    $cmd.Parameters['@branch'].Value=$branch
    foreach ($name in @('@start','@end')) { [void]$cmd.Parameters.Add($name,[Data.SqlDbType]::DateTime) }
    $cmd.Parameters['@start'].Value=$start; $cmd.Parameters['@end'].Value=$start.AddMonths(1)
    $tx=$conn.BeginTransaction([Data.IsolationLevel]::Serializable)
    $cmd.Transaction=$tx
    $reader=$cmd.ExecuteReader()
    $buffer=[Collections.Generic.List[object]]::new()
    while ($reader.Read()) {
        if ($buffer.Count -ge 20000) { throw 'AUDIT_ROW_LIMIT' }
        $values=[object[]]::new(6)
        [void]$reader.GetValues($values)
        $buffer.Add($values)
    }
    $reader.Close()
    $tx.Commit()
    $out=[IO.File]::Open([IO.Path]::GetFullPath($OutFile),'CreateNew','Write','None')
    $created=$true
    $writer=[Xml.XmlWriter]::Create($out)
    $writer.WriteStartElement('sales')
    $writer.WriteAttributeString('period',$Month)
    $writer.WriteAttributeString('count',[string]$buffer.Count)
    foreach ($row in $buffer) {
        $writer.WriteStartElement('row')
        $cells=[ordered]@{company=$p.company; period=$Month; branch=$branch.ToString(); book='finance';
            id=$row[0].ToString(); number=$row[1].ToString(); posted=$row[2].ToString();
            amount=$row[3].ToString(); detailAmount=$row[4].ToString(); detailRows=$row[5].ToString()}
        foreach ($name in $cells.Keys) { $writer.WriteElementString($name,[string]$cells[$name]) }
        $writer.WriteEndElement()
    }
    $writer.WriteEndElement(); $writer.Close(); $out.Close(); $complete=$true
    Write-Output 'AUDIT_SALES_EXTRACT_CREATED'
} catch {
    $msg=$_.Exception.Message
    if ($msg -notmatch '^AUDIT_[A-Z_]+$') { $msg='AUDIT_SQL_OR_OUTPUT_ERROR' }
    [Console]::Error.WriteLine($msg)
    exit 1
} finally {
    if ($reader) { $reader.Dispose() }
    if ($conn) { $conn.Dispose() }
    if ($writer) { $writer.Dispose() }
    if ($out) { $out.Dispose() }
    if ($created -and !$complete) { [IO.File]::Delete([IO.Path]::GetFullPath($OutFile)) }
}
