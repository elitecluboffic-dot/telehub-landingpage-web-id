<?php
/*
 *  Self-hosted sitemaps relay script
 *  (c) 2015-2026 PRO Sitemaps,  https://pro-sitemaps.com
 *
 */

 /*
  * Configuration
  *
  * site_id - your website account ID in PRO Sitemaps service
  * site_url - your website URL
  * sitemap_self_url - the link to sitemap on your domain
  * sitemap_remote_url - the link to the PRO Sitemaps API endpoint
  *
  */

 $script_config = array(
 	'ps_api' => '20260219',
    'site_id' => '4730211',
    'site_url' => 'https://telehub.web.id',
    'api_key' => 'ps_KoeMnRcr.RUM26WV83g3SIU4qcG3cH9B492P3PL6bRBkto61C6KRZXVr',
    'sitemap_self_url' => 'https://telehub.web.id/pro-sitemaps-4730211.php',
    'sitemap_remote_url' => 'https://api.pro-sitemaps.com/'
 );

 $sitemap_filename = isset($_GET['sn']) ? preg_replace('#[^a-z\d\.\_\-]#i', '', $_GET['sn']) : 'sitemap.xml';



/*
 * Retrieve remote sitemap
 *
 * Check if cURL library is installed, prepare API request and get response
 *
 */
    if(!function_exists('curl_init')){
        echo 'Error: cURL library not enabled';
        exit;
    }
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $script_config['sitemap_remote_url']);

    $headers = array(
        'User-Agent: Mozilla/5.0 (compatible; PRO Sitemaps Self-hosted sitemaps script; pro-sitemaps.com) Gecko XML-Sitemaps/1.0',
    );
    $fields = array(
        'method' => 'download_sitemap',
        'api_ver' => $script_config['ps_api'],
        'api_key' => $script_config['api_key'],
        'site_id' => $script_config['site_id'],
        'sitemap_self_url' => $script_config['sitemap_self_url'],
        'sitemap_id' => $sitemap_filename,

        'remote_ip' => $_SERVER['REMOTE_ADDR'],
        'remote_user_agent' => $_SERVER['HTTP_USER_AGENT'],
    );
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $fields);

    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);

    $result = curl_exec($ch);
    $info = curl_getinfo($ch);
    // curl_close($ch);

/*
 * Parse API response and send content to client
 *
 */
 	header('PRO-Sitemaps-API-v: '.$script_config['ps_api']);

    if(($info['http_code'] != '200') || strstr($info['content_type'], 'json') ){
        $status_message = '503 Service Temporarily Unavailable';
        header('HTTP/1.1 '.$status_message);
        header('Status: '.$status_message);
        header('Retry-After: 300');
        echo $status_message;
    }else {
        header('Content-Type: ' . $info['content_type']);
        if (function_exists("ob_start") && function_exists("ob_gzhandler"))
        {
            ob_start("ob_gzhandler");
        }else {
            header('Content-Length: ' . strlen($result));
        }
        echo $result;
    }
    exit;
